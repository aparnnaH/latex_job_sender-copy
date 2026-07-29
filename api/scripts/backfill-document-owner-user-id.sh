#!/usr/bin/env bash
set -euo pipefail

storage_root="${1:-${DOCUMENT_PROCESSING_STORAGE_ROOT:-/tmp/tailortex-documents}}"
owner_user_id="${2:-${DOCUMENT_PROCESSING_DEVELOPMENT_USER_ID:-development-user}}"

if [ ! -d "$storage_root" ]; then
  echo "Storage root does not exist: $storage_root" >&2
  exit 1
fi

find "$storage_root" -name document.json -type f -print0 |
  while IFS= read -r -d '' document_path; do
    tmp_path="${document_path}.tmp"
    jq --arg ownerUserId "$owner_user_id" \
      'if has("ownerUserId") then . else . + {ownerUserId: $ownerUserId} end' \
      "$document_path" > "$tmp_path"
    mv "$tmp_path" "$document_path"
  done
