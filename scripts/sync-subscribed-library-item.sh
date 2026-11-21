#!/usr/bin/env bash
set -euo pipefail

: "${VCENTER:?VCENTER must be set}"
: "${VCENTER_USERNAME:?VCENTER_USERNAME must be set}"
: "${VCENTER_PASSWORD:?VCENTER_PASSWORD must be set}"

if [[ $# -lt 3 || $# -gt 4 ]]; then
  echo "Usage: $0 <subscribed-library-name> <item-name> <source-item-json> [timeout-seconds]" >&2
  exit 2
fi

SUBSCRIBED_LIBRARY_NAME="$1"
ITEM_NAME="$2"
SOURCE_JSON="$3"
TIMEOUT_SECONDS="${4:-900}"
POLL_SECONDS=10

for cmd in curl jq; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "ERROR: required command '$cmd' was not found" >&2
    exit 1
  }
done

SESSION_ID=$(curl -fsSk \
  -u "${VCENTER_USERNAME}:${VCENTER_PASSWORD}" \
  -X POST \
  "https://${VCENTER}/api/session" | jq -r '.')

if [[ -z "$SESSION_ID" || "$SESSION_ID" == "null" ]]; then
  echo "ERROR: unable to obtain vCenter API session" >&2
  exit 1
fi

cleanup() {
  curl -fsSk \
    -H "vmware-api-session-id: ${SESSION_ID}" \
    -X DELETE \
    "https://${VCENTER}/api/session" >/dev/null 2>&1 || true
}
trap cleanup EXIT

SUBSCRIBED_LIBRARY_ID=""
while IFS= read -r library_id; do
  [[ -z "$library_id" ]] && continue
  library_name=$(curl -fsSk \
    -H "vmware-api-session-id: ${SESSION_ID}" \
    "https://${VCENTER}/api/content/subscribed-library/${library_id}" \
    | jq -r 'if has("value") then .value.name else .name end // empty')

  if [[ "$library_name" == "$SUBSCRIBED_LIBRARY_NAME" ]]; then
    SUBSCRIBED_LIBRARY_ID="$library_id"
    break
  fi
done < <(
  curl -fsSk \
    -H "vmware-api-session-id: ${SESSION_ID}" \
    "https://${VCENTER}/api/content/subscribed-library" \
    | jq -r 'if type == "array" then .[] else .value[] end'
)

if [[ -z "$SUBSCRIBED_LIBRARY_ID" ]]; then
  echo "ERROR: subscribed Content Library not found: ${SUBSCRIBED_LIBRARY_NAME}" >&2
  exit 1
fi

find_item_id() {
  curl -fsSk \
    -H "vmware-api-session-id: ${SESSION_ID}" \
    -H "Content-Type: application/json" \
    -X POST \
    "https://${VCENTER}/api/content/library/item?action=find" \
    -d "$(jq -nc --arg name "$ITEM_NAME" --arg library_id "$SUBSCRIBED_LIBRARY_ID" '{name:$name,library_id:$library_id}')" \
    | jq -r 'if type == "array" then .[0] else .value[0] end // empty'
}

ITEM_ID=$(find_item_id)

if [[ -z "$ITEM_ID" ]]; then
  # A newly created source item only appears in the subscriber after a
  # library-level sync (automatic sync is disabled for this library).
  echo "Item '${ITEM_NAME}' is not in subscribed library '${SUBSCRIBED_LIBRARY_NAME}' yet; triggering a library sync..."
  curl -fsSk \
    -H "vmware-api-session-id: ${SESSION_ID}" \
    -X POST \
    "https://${VCENTER}/api/content/subscribed-library/${SUBSCRIBED_LIBRARY_ID}?action=sync" >/dev/null

  start_epoch=$(date +%s)
  while [[ -z "$ITEM_ID" ]]; do
    if (( $(date +%s) - start_epoch >= TIMEOUT_SECONDS )); then
      echo "ERROR: item '${ITEM_NAME}' did not appear in subscribed library '${SUBSCRIBED_LIBRARY_NAME}' within ${TIMEOUT_SECONDS}s" >&2
      exit 1
    fi
    sleep "$POLL_SECONDS"
    ITEM_ID=$(find_item_id)
  done
  echo "Item appeared in subscribed library: ${ITEM_ID}"
fi

SOURCE_ITEM_ID=$(jq -r '.item_id // empty' "$SOURCE_JSON")
SOURCE_CONTENT_VERSION=$(jq -r '.content_version // empty' "$SOURCE_JSON")

if [[ -z "$SOURCE_ITEM_ID" || -z "$SOURCE_CONTENT_VERSION" ]]; then
  echo "ERROR: source item JSON is missing item_id or content_version" >&2
  exit 1
fi

printf "Triggering manual synchronization of '%s' in subscribed library '%s'...\n" "$ITEM_NAME" "$SUBSCRIBED_LIBRARY_NAME"
echo "Expected source item: ${SOURCE_ITEM_ID}"
echo "Expected content_version: ${SOURCE_CONTENT_VERSION}"

# Automatic synchronization is intentionally disabled for this library. Trigger
# the subscribed item sync from the pipeline so the updated metadata and OVF
# content are pulled immediately. force_sync_content=true is appropriate because
# the subscribed library is configured to download content immediately.
response_file=$(mktemp)
http_code=$(curl -sSk \
  -o "$response_file" \
  -w '%{http_code}' \
  -H "vmware-api-session-id: ${SESSION_ID}" \
  -H "Content-Type: application/json" \
  -X POST \
  "https://${VCENTER}/api/content/library/subscribed-item/${ITEM_ID}?action=sync" \
  -d '{"force_sync_content":true}')

if [[ ! "$http_code" =~ ^2 ]]; then
  echo "ERROR: subscribed item sync request failed with HTTP ${http_code}" >&2
  if [[ -s "$response_file" ]]; then
    cat "$response_file" >&2
    echo >&2
  fi
  rm -f "$response_file"
  exit 1
fi
rm -f "$response_file"

echo "Manual sync request accepted. Waiting for subscriber to reach the source revision..."

start_epoch=$(date +%s)
while true; do
  item_json=$(curl -fsSk \
    -H "vmware-api-session-id: ${SESSION_ID}" \
    "https://${VCENTER}/api/content/library/item/${ITEM_ID}")

  normalized=$(jq -c 'if has("value") then .value else . end' <<<"$item_json")
  source_id=$(jq -r '.source_id // empty' <<<"$normalized")
  version=$(jq -r '.version // empty' <<<"$normalized")
  content_version=$(jq -r '.content_version // empty' <<<"$normalized")
  cached=$(jq -r '.cached // false' <<<"$normalized")

  if [[ "$source_id" == "$SOURCE_ITEM_ID" \
     && "$content_version" == "$SOURCE_CONTENT_VERSION" \
     && "$cached" == "true" ]]; then
    echo "PASS: subscribed item synchronized and content cached"
    echo "  subscribed_library_id: ${SUBSCRIBED_LIBRARY_ID}"
    echo "  subscribed_item_id:    ${ITEM_ID}"
    echo "  source_item_id:        ${SOURCE_ITEM_ID}"
    echo "  subscriber_version:    ${version:-<empty>}"
    echo "  content_version:       ${content_version}"
    echo "  cached:                ${cached}"
    exit 0
  fi

  now_epoch=$(date +%s)
  elapsed=$((now_epoch - start_epoch))
  if (( elapsed >= TIMEOUT_SECONDS )); then
    echo "ERROR: timed out waiting for subscribed item synchronization after ${TIMEOUT_SECONDS}s" >&2
    echo "Last observed: source_id=${source_id:-<empty>} version=${version:-<empty>} content_version=${content_version:-<empty>} cached=${cached}" >&2
    exit 1
  fi

  echo "Waiting for subscriber sync: source_id=${source_id:-<empty>} version=${version:-<empty>} content_version=${content_version:-<empty>} cached=${cached}"
  sleep "$POLL_SECONDS"
done
