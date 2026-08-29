#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v rg >/dev/null 2>&1; then
  echo "check-raw-sends: rg is required" >&2
  exit 1
fi

violations=()

while IFS= read -r match; do
  [[ -z "$match" ]] && continue

  file="${match%%:*}"
  rest="${match#*:}"
  line="${rest%%:*}"
  text="${rest#*:}"

  allowed=false
  case "$file" in
    apps/electron/src/main/window-manager.ts)
      [[ "$text" == *"window.webContents.send(channel, ...args)"* ]] && allowed=true
      ;;
    apps/electron/src/main/index.ts)
      [[ "$text" == *"_event.sender.send('transfer:progress'"* ]] && allowed=true
      ;;
    apps/electron/src/main/browser-pane-manager.ts)
      [[ "$text" == *"toolbarView.webContents.send(TOOLBAR_CHANNELS.FORCE_CLOSE_MENU"* ]] && allowed=true
      [[ "$text" == *"toolbarView.webContents.send(TOOLBAR_CHANNELS.STATE_UPDATE"* ]] && allowed=true
      [[ "$text" == *"toolbarView.webContents.send(TOOLBAR_CHANNELS.THEME_COLOR"* ]] && allowed=true
      ;;
    apps/electron/src/preload/bootstrap.ts)
      [[ "$text" == *"ipcRenderer.send('__transport:status'"* ]] && allowed=true
      ;;
    apps/electron/src/main/licensing/runtime.ts)
      # Licensing gates the WS transport itself: preload asks
      # __license:authorize-channel before exposing a channel, so routing these
      # pushes through the typed sink would be circular. Both pair with
      # ipcRenderer.on listeners in preload/bootstrap.ts.
      [[ "$text" == *"window.webContents.send(LICENSE_IPC.STATE_CHANGED"* ]] && allowed=true
      [[ "$text" == *"_event.sender.send(LICENSE_IPC.REQUIRED)"* ]] && allowed=true
      ;;
  esac
  true

  if [[ "$allowed" != true ]]; then
    violations+=("$file:$line:$text")
  fi
done < <(
  rg -n "webContents\.send\(|event\.sender\.send\(|ipcRenderer\.send\(" \
    apps/electron/src/main \
    apps/electron/src/preload \
    -g '!**/__tests__/**' \
    -g '!**/*.test.ts' \
    -g '!**/*.test.tsx' || true
)

if (( ${#violations[@]} > 0 )); then
  echo "Raw Electron sends must use the typed transport/event sink unless explicitly allowlisted." >&2
  printf '%s\n' "${violations[@]}" >&2
  exit 1
fi
