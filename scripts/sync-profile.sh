#!/usr/bin/env bash
set -euo pipefail

SRC="$HOME/Library/Application Support/Google/Chrome/Default"
DEST_PARENT="$HOME/.cache/chrome-devtools-mcp/chrome-profile"
DEST="$DEST_PARENT/Default"

if ! [[ -d "$SRC" ]]; then
  echo "Источник не найден: $SRC" >&2
  exit 1
fi

if pgrep -f "Google Chrome.app/Contents/MacOS/Google Chrome" >/dev/null 2>&1; then
  echo "ВНИМАНИЕ: запущен Chrome." >&2
  echo "Профиль копировать с открытым Chrome нельзя — SQLite-файлы (Cookies, Login Data, History) будут повреждены." >&2
  echo "Закрой ВСЕ окна Chrome (включая dev-Chrome на 9222) и запусти скрипт снова." >&2
  exit 1
fi

mkdir -p "$DEST_PARENT"

if [[ -e "$DEST" ]]; then
  BACKUP="$DEST.bak.$(date +%Y%m%d-%H%M%S)"
  echo "Существующий dev-профиль -> бэкап: $BACKUP"
  mv "$DEST" "$BACKUP"
fi

echo "Копирую $SRC -> $DEST"
echo "(может занять минуту, профиль ~150-500 MB)"
rsync -a \
  --exclude 'Cache' \
  --exclude 'Code Cache' \
  --exclude 'GPUCache' \
  --exclude 'Service Worker/CacheStorage' \
  --exclude 'ShaderCache' \
  --exclude 'DawnGraphiteCache' \
  --exclude 'DawnWebGPUCache' \
  --exclude 'GrShaderCache' \
  --exclude 'component_crx_cache' \
  --exclude 'optimization_guide_*' \
  "$SRC/" "$DEST/"

# подчищаем lock-файлы прежней сессии, если затесались
rm -f "$DEST_PARENT/SingletonLock" "$DEST_PARENT/SingletonCookie" "$DEST_PARENT/SingletonSocket"

echo "Готово. Размер dev-профиля:"
du -sh "$DEST_PARENT"
echo "Запусти: ./scripts/start-chrome-dev.sh"
