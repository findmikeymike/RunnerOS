#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# Shared packages affect consumers; check the complete graph for staged code/config.
while IFS= read -r -d '' file; do
  case "$file" in
    *.ts|*.tsx|*.js|*.jsx|*.mts|*.cts|*.mjs|*.cjs|*/package.json|package.json|*tsconfig*.json|bun.lock|bun.lockb|scripts/typecheck-staged.sh)
      bun run check:dependency-containment
      exec bun run typecheck:all
      ;;
  esac
done < <(git diff --cached --name-only -z)
echo 'No staged typecheck inputs.'
