# list.am map marks

Chrome MV3 расширение для доски объявлений [list.am](https://www.list.am). Помечает объявления тремя статусами и управляет их видимостью на «виде с картой» (`gl=8`).

## Возможности

**Три статуса** (тоггл — повторный клик снимает):

- **★ Важное** — метка перекрашивается в красный (`islands#redStretchyIcon`).
- **• Среднее** — метка перекрашивается в зелёный (`islands#greenStretchyIcon`).
- **⊘ Скрыть с карты** — метка пропадает мгновенно, не возвращается при панорамировании и перезагрузке.

Жёлтый цвет специально не используется — у list.am он зарезервирован под платные объявления (`highlight: "1"`).

**Где доступны кнопки:**

- В мини-карточке `#mapinfo` (открывается при клике на метку на карте).
- На странице объявления `list.am/item/<id>` — панель сразу под заголовком.
- Состояние синхронизировано: пометил с одной страницы → видно на другой через `chrome.storage.local`.

**Popup расширения** (клик по иконке в тулбаре):

- Счётчики ★/•/⊘ и общее число записей.
- Тоггл **«Показывать скрытые метки (серым)»** — при включённом hidden-метки остаются на карте серым preset'ом (`islands#grayStretchyIcon`) вместо удаления. Удобно если хочется видеть «всё что я уже отбросил».
- Экспорт всех меток + настроек одним JSON.
- Сброс всех меток.

## Как это работает (вкратце)

list.am рисует карту на Yandex Maps API 2.1, метки сидят в Clusterer'е (для производительности при ~1000 точек). У объявления нет `id` в свойствах placemark'а, есть только `iconContent` с ценой. Поэтому связку placemark ↔ id строим по координатам.

1. `injected.js` (MAIN world) на `document_start` подменяет `window.ymaps` через `Object.defineProperty` ещё до `?onload=` callback'а Yandex API. Через `Proxy({construct})` хукаем `ymaps.Map` и сохраняем инстанс.
2. Параллельно патчим `XMLHttpRequest`/`fetch`: на каждом ответе `/aj-category-map` строим `coordsToIds` и (если нужно) выкидываем объявления со статусом `hidden`.
3. После `ymaps.ready` + ретраи обходим `clusterer.getGeoObjects()`, по координатам каждой метки находим id и кладём её в `pmById`.
4. Перекраска live: `pm.options.set('preset', '...')`. Original preset (синий или оранжевый) сохраняется в `WeakMap` чтобы корректно откатываться при снятии статуса.
5. Удаление live: ищем владеющий метку контейнер (Clusterer) и `container.remove(pm)`.
6. Состояние — в `chrome.storage.local`: `marks: { "<id>": "important" | "medium" | "hidden" }` и `settings: { showHidden: bool }`.

## Структура

```
manifest.json     MV3
content.js        isolated world: панели в #mapinfo и на /item/<id>, мост в MAIN
injected.js       MAIN world: ymaps hook, XHR patch, live-перекраска и удаление
ui.css            стили кнопок
popup.html/.js    счётчики, тоггл «показывать скрытые», экспорт, сброс
background.js     заглушка SW
scripts/
  start-chrome-dev.sh   запуск изолированного Chrome для разработки
  sync-profile.sh       синхронизация копии пользовательского профиля
```

## Установка для разработки

Чтобы list.am пропустил сессию через Cloudflare, нужны cookies реального профиля. Поэтому используется отдельный Chrome с копией пользовательского профиля:

```bash
# 1) Полностью закрыть основной Chrome (Cmd+Q)
./scripts/sync-profile.sh

# 2) Запустить dev-Chrome
./scripts/start-chrome-dev.sh
```

Установка unpacked в dev-Chrome:

1. `chrome://extensions/`
2. Включить «Developer mode» (правый верхний угол).
3. **Load unpacked** → выбрать корень репозитория.

После первичной установки расширение запоминается в Preferences и подхватывается при каждом запуске. CLI-флаг `--load-extension` в Chrome 137+ для обычных профилей не работает.

## Лицензия

MIT.
