#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <before.json> <after.json> <output.json>" >&2
  exit 2
fi

BEFORE="$1"
AFTER="$2"
OUTPUT="$3"

: "${IMAGE_VERSION:?IMAGE_VERSION must be set}"
: "${IMAGE_NAME:?IMAGE_NAME must be set}"
: "${PACKER_SOURCE_REF:?PACKER_SOURCE_REF must be set}"
: "${GITHUB_SHA:?GITHUB_SHA must be set}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID must be set}"
: "${GITHUB_RUN_NUMBER:?GITHUB_RUN_NUMBER must be set}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"

jq -n \
  --arg image_name "$IMAGE_NAME" \
  --arg image_version "$IMAGE_VERSION" \
  --arg packer_source_ref "$PACKER_SOURCE_REF" \
  --arg repository "$GITHUB_REPOSITORY" \
  --arg commit "$GITHUB_SHA" \
  --arg run_id "$GITHUB_RUN_ID" \
  --arg run_number "$GITHUB_RUN_NUMBER" \
  --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --slurpfile before "$BEFORE" \
  --slurpfile after "$AFTER" \
  '{
    schema_version: 1,
    image: {
      name: $image_name,
      version: $image_version,
      packer_source_ref: $packer_source_ref
    },
    provenance: {
      repository: $repository,
      commit: $commit,
      workflow_run_id: $run_id,
      workflow_run_number: $run_number,
      generated_at: $generated_at
    },
    content_library: {
      before: $before[0],
      after: $after[0]
    }
  }' > "$OUTPUT"

sha256sum "$OUTPUT" > "${OUTPUT}.sha256"

echo "Created ${OUTPUT}"
echo "Created ${OUTPUT}.sha256"
