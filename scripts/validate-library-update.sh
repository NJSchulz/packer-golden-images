#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <before.json> <after.json>" >&2
  exit 2
fi

BEFORE="$1"
AFTER="$2"

for cmd in jq; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "ERROR: required command '$cmd' was not found" >&2
    exit 1
  }
done

before_uuid=$(jq -r '.item_id' "$BEFORE")
after_uuid=$(jq -r '.item_id' "$AFTER")
before_library=$(jq -r '.library_id' "$BEFORE")
after_library=$(jq -r '.library_id' "$AFTER")
before_created=$(jq -r '.creation_time' "$BEFORE")
after_created=$(jq -r '.creation_time' "$AFTER")
before_modified=$(jq -r '.last_modified_time' "$BEFORE")
after_modified=$(jq -r '.last_modified_time' "$AFTER")
before_content=$(jq -r '.content_version | tonumber' "$BEFORE")
after_content=$(jq -r '.content_version | tonumber' "$AFTER")

failed=0

check_equal() {
  local label="$1" before="$2" after="$3"
  if [[ "$before" != "$after" ]]; then
    echo "ERROR: ${label} changed: '${before}' -> '${after}'" >&2
    failed=1
  else
    echo "PASS: ${label} unchanged (${before})"
  fi
}

check_equal "Content Library item UUID" "$before_uuid" "$after_uuid"
check_equal "Content Library ID" "$before_library" "$after_library"
check_equal "creation_time" "$before_created" "$after_created"

if [[ "$after_modified" > "$before_modified" ]]; then
  echo "PASS: last_modified_time advanced: ${before_modified} -> ${after_modified}"
else
  echo "ERROR: last_modified_time did not advance: ${before_modified} -> ${after_modified}" >&2
  failed=1
fi

# This validator is run against the authoritative local library that Packer
# publishes into. On that source item, a successful content replacement must
# advance content_version.
if (( after_content > before_content )); then
  echo "PASS: content_version increased: ${before_content} -> ${after_content}"
else
  echo "ERROR: content_version did not increase: ${before_content} -> ${after_content}" >&2
  failed=1
fi

if (( failed != 0 )); then
  echo "Golden image update validation FAILED" >&2
  exit 1
fi

echo "Golden image update validation PASSED"
