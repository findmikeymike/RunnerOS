#!/usr/bin/env bash
# Emits valid JSON on stdout, noise on stderr, exits non-zero.
cat > /dev/null
echo "warning: something noisy" >&2
echo '{"action":"allow","message":"still ok"}'
exit 7
