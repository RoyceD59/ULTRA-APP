#!/bin/bash
set -e
pnpm install --frozen-lockfile

set +e
db_push_output="$(pnpm --filter @workspace/db run push-force 2>&1)"
db_push_status=$?
set -e
printf '%s\n' "$db_push_output"

if [ "$db_push_status" -ne 0 ] || grep -q "Interactive prompts require a TTY" <<<"$db_push_output"; then
  echo "Development database push did not complete non-interactively." >&2
  exit 2
fi

pnpm --filter @workspace/api-spec run codegen
