#!/usr/bin/env sh
set -eu

if command -v pnpm >/dev/null 2>&1; then
  command -v pnpm
  exit 0
fi

for candidate in "$@"; do
  if [ -x "$candidate" ]; then
    printf '%s\n' "$candidate"
    exit 0
  fi
done

echo "Velo pre-commit requires pnpm; install pnpm or make it available in the Git hook PATH." >&2
exit 127
