#!/usr/bin/env bash
set -euo pipefail

CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE_DIR="$HOME/.cache/chrome-devtools-mcp/chrome-profile"
DEBUG_PORT=9222

if ! [[ -x "$CHROME_BIN" ]]; then
  echo "Chrome не найден: $CHROME_BIN" >&2
  exit 1
fi

if ! [[ -d "$PROFILE_DIR" ]]; then
  echo "Dev-профиль отсутствует: $PROFILE_DIR" >&2
  echo "Сначала запусти ./scripts/sync-profile.sh чтобы скопировать основной профиль." >&2
  exit 1
fi

if lsof -nP -iTCP:"$DEBUG_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Порт $DEBUG_PORT уже занят. Возможно dev-Chrome уже запущен." >&2
  exit 1
fi

if [[ -e "$PROFILE_DIR/SingletonLock" ]]; then
  echo "В профиле остался SingletonLock (предыдущий dev-Chrome упал?)." >&2
  echo "Удаляю: $PROFILE_DIR/SingletonLock" >&2
  rm -f "$PROFILE_DIR/SingletonLock" "$PROFILE_DIR/SingletonCookie" "$PROFILE_DIR/SingletonSocket"
fi

# Расширения для авто-загрузки (можно несколько через запятую).
# По умолчанию — наше расширение из корня репо.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_EXT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXTENSIONS="${LAM_EXTENSIONS:-$DEFAULT_EXT}"

echo "Запускаю dev-Chrome:"
echo "  profile:    $PROFILE_DIR"
echo "  debug:      http://127.0.0.1:$DEBUG_PORT"
echo "  extensions: $EXTENSIONS"

# Перед запуском гарантируем что extensions.ui.developer_mode = true,
# иначе Chrome 137+ молча игнорирует --load-extension.
PREFS="$PROFILE_DIR/Default/Preferences"
if [[ -f "$PREFS" ]]; then
  python3 - "$PREFS" <<'PY' || echo "(не удалось включить developer_mode в Preferences)" >&2
import json, sys, pathlib
p = pathlib.Path(sys.argv[1])
try:
    data = json.loads(p.read_text())
except Exception as e:
    print("prefs parse error:", e); raise SystemExit(0)
ui = data.setdefault("extensions", {}).setdefault("ui", {})
if ui.get("developer_mode") is not True:
    ui["developer_mode"] = True
    p.write_text(json.dumps(data))
PY
fi

exec "$CHROME_BIN" \
  --user-data-dir="$PROFILE_DIR" \
  --remote-debugging-port="$DEBUG_PORT" \
  --load-extension="$EXTENSIONS" \
  --no-first-run \
  --no-default-browser-check \
  --disable-features=ChromeWhatsNewUI,DisableLoadExtensionCommandLineSwitch \
  "$@"
