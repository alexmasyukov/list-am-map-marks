# list.am map marks

Chrome MV3 расширение для доски объявлений [list.am](https://www.list.am). Добавляет на вид «карта» (`gl=8`) три кнопки в карточку метки:

- **★ Важное** — метка перекрашивается в красный (`islands#redStretchyIcon`).
- **• Среднее** — метка перекрашивается в зелёный (`islands#greenStretchyIcon`).
- **⊘ Скрыть с карты** — метка пропадает мгновенно и не возвращается при панорамировании/перезагрузке.

Жёлтый цвет специально не используется — у list.am он зарезервирован под платные объявления (`highlight: "1"`).

## Как это работает

Карта list.am собрана на Yandex Maps API 2.1, метки — внутри Clusterer'а (для производительности при ~1000 точек). У объявления нет id в `properties`, есть только `iconContent` с ценой. Поэтому связку placemark ↔ id строим по координатам:

1. `injected.js` (MAIN world) подменяет `window.ymaps` через `Object.defineProperty` ещё до `?onload=` callback'а Yandex API. Через `Proxy({construct})` хукаем `ymaps.Map` и сохраняем инстанс.
2. Параллельно патчим `XMLHttpRequest`/`fetch`: на каждом ответе `/aj-category-map` строим `coordsToIds` и выкидываем все объявления со статусом `hidden`.
3. После `ymaps.ready` + retries обходим `clusterer.getGeoObjects()`, по координатам каждой метки находим id и кладём её в `pmById`.
4. Состояние меток — в `chrome.storage.local` под ключом `marks` (`{ "<id>": "important" | "medium" | "hidden" }`).
5. Перекраска: `pm.options.set('preset', '...')`. Original preset (синий или оранжевый) сохраняется в `WeakMap` чтобы корректно откатываться при снятии статуса.
6. Удаление live: ищем владеющий метку контейнер (Clusterer) и `container.remove(pm)`.

## Структура

```
manifest.json     MV3
content.js        isolated world: UI кнопок в #mapinfo, мост в MAIN
injected.js       MAIN world: ymaps hook, XHR patch, live-перекраска и удаление
ui.css            стили кнопок панели в #mapinfo
popup.html/.js    счётчики важных/средних/скрытых, экспорт JSON, сброс
background.js     заглушка SW
scripts/
  start-chrome-dev.sh   запуск изолированного Chrome для разработки
  sync-profile.sh       синхронизация копии пользовательского профиля
```

## Установка

Чтобы list.am пропустил сессию через Cloudflare, нужны cookies реального профиля. Поэтому для разработки используется отдельный Chrome с копией пользовательского профиля:

```bash
# 1) Полностью закрыть основной Chrome (Cmd+Q)
./scripts/sync-profile.sh

# 2) Запустить dev-Chrome
./scripts/start-chrome-dev.sh
```

Установить unpacked в dev-Chrome:
1. `chrome://extensions/`
2. Включить «Developer mode» (правый верхний угол).
3. **Load unpacked** → выбрать корень репозитория.

После первичной установки расширение запоминается в Preferences и подхватывается при каждом запуске. CLI-флаг `--load-extension` в Chrome 137+ для обычных профилей не работает.

## Лицензия

MIT.
