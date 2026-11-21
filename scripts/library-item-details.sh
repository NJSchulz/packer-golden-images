#!/usr/bin/env bash
set -euo pipefail

: "${VCENTER:?VCENTER must be set}"
: "${VCENTER_USERNAME:?VCENTER_USERNAME must be set}"
: "${VCENTER_PASSWORD:?VCENTER_PASSWORD must be set}"

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <content-library-name> <content-library-item-name>" >&2
  exit 2
fi

LIBRARY_NAME="$1"
ITEM_NAME="$2"

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

library_matches=()
while IFS= read -r library_id; do
  [[ -z "$library_id" ]] && continue
  current_name=$(curl -fsSk \
    -H "vmware-api-session-id: ${SESSION_ID}" \
    "https://${VCENTER}/api/content/library/${library_id}" \
    | jq -r 'if has("value") then .value.name else .name end // empty')

  if [[ "$current_name" == "$LIBRARY_NAME" ]]; then
    library_matches+=("$library_id")
  fi
done < <(
  curl -fsSk \
    -H "vmware-api-session-id: ${SESSION_ID}" \
    "https://${VCENTER}/api/content/library" \
    | jq -r 'if type == "array" then .[] else .value[] end'
)

if (( ${#library_matches[@]} == 0 )); then
  echo "ERROR: Content Library not found: ${LIBRARY_NAME}" >&2
  exit 1
fi

if (( ${#library_matches[@]} > 1 )); then
  echo "ERROR: multiple Content Libraries named '${LIBRARY_NAME}' were found; library name must be unique for automation" >&2
  exit 1
fi

LIBRARY_ID="${library_matches[0]}"

ITEM_ID=$(curl -fsSk \
  -H "vmware-api-session-id: ${SESSION_ID}" \
  -H "Content-Type: application/json" \
  -X POST \
  "https://${VCENTER}/api/content/library/item?action=find" \
  -d "$(jq -nc --arg name "$ITEM_NAME" --arg library_id "$LIBRARY_ID" '{name:$name,library_id:$library_id}')" \
  | jq -r 'if type == "array" then .[0] else .value[0] end // empty')

# Exit code 3 means "library found, item does not exist yet" so callers can
# treat the first build of a new image as a create instead of a failure.
if [[ -z "$ITEM_ID" ]]; then
  echo "ERROR: Content Library item not found: ${LIBRARY_NAME}/${ITEM_NAME}" >&2
  exit 3
fi

curl -fsSk \
  -H "vmware-api-session-id: ${SESSION_ID}" \
  "https://${VCENTER}/api/content/library/item/${ITEM_ID}" \
  | jq --arg item_id "$ITEM_ID" --arg library_name "$LIBRARY_NAME" '
      (if has("value") then .value else . end) |
      {
        item_id: $item_id,
        name,
        library_name: $library_name,
        library_id,
        source_id,
        type,
        version,
        content_version,
        metadata_version,
        cached,
        creation_time,
        last_modified_time
      }
    '
