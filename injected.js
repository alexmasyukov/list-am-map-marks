// injected.js — MAIN world.
// - Хукает ymaps.Map / ymaps.Placemark через Proxy на document_start, чтобы поймать
//   инстансы в момент создания (на window list.am их не выставляет).
// - Перехватывает XHR/fetch /aj-category-map: выкидывает hidden, копит coordsToIds.
// - На команды от content.js: важное/среднее → меняем preset placemark'а в живую,
//   скрыть → map.geoObjects.remove(placemark).

(() => {
  const URL_PATTERN = /\/aj-category-map(\?|$)/;
  const PRESET = {
    important: 'islands#redStretchyIcon',
    medium:    'islands#greenStretchyIcon',
    hidden:    'islands#grayStretchyIcon',
  };

  const STATE = {
    marks: {},
    settings: { showHidden: false },
    map: null,
    clusterers: new Set(),
    pmById: new Map(),
    pmByCoord: new Map(),
    pmContainer: new WeakMap(),
    coordsToIds: new Map(),
    pmOrigPreset: new WeakMap(),
  };
  // debug-окно (только пока разрабатываем)
  window.__lam = STATE;

  // ---------- bridge ----------
  const MSG = {
    MARKS_PUSH: 'lam:marks-push',
    SETTINGS_PUSH: 'lam:settings-push',
    MARK_UPDATE_ID: 'lam:mark-update',
    MAIN_READY: 'lam:main-ready',
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== 'lam-content') return;
    if (d.type === MSG.MARKS_PUSH) {
      STATE.marks = d.marks || {};
      reharvestAll();
      for (const [id, set] of STATE.pmById.entries()) {
        for (const pm of set) applyMarkToPlacemark(pm, id);
      }
    } else if (d.type === MSG.SETTINGS_PUSH) {
      const prev = STATE.settings.showHidden;
      STATE.settings = Object.assign({}, STATE.settings, d.settings || {});
      if (prev !== STATE.settings.showHidden) onShowHiddenToggled(prev, STATE.settings.showHidden);
    } else if (d.type === MSG.MARK_UPDATE_ID) {
      reharvestAll();
      const id = String(d.id);
      handleStatusChange(id);
    }
  });
  window.postMessage({ source: 'lam-injected', type: MSG.MAIN_READY }, '*');

  // ---------- response filter ----------
  // - всегда обновляем coordsToIds;
  // - hidden выкидываем только если settings.showHidden === false; иначе оставляем (потом перекрасим в серый).
  const filterMapResponse = (rawText) => {
    try {
      const json = JSON.parse(rawText);
      if (!json || !Array.isArray(json.data)) return rawText;
      const showHidden = !!STATE.settings.showHidden;
      const filtered = [];
      for (const point of json.data) {
        if (!point || !Array.isArray(point.data)) { filtered.push(point); continue; }
        const ck = normCoordKey(point.lat, point.lng);
        STATE.coordsToIds.set(ck, point.data.map(ad => String(ad.id)));

        const ads = showHidden
          ? point.data
          : point.data.filter(ad => STATE.marks[String(ad.id)] !== 'hidden');
        if (ads.length === 0) continue;
        filtered.push({ ...point, data: ads });
      }
      return JSON.stringify({ ...json, data: filtered });
    } catch (err) {
      console.warn('[lam] filter parse error', err);
      return rawText;
    }
  };

  // ---------- patch XHR ----------
  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open;
  const origSend = XHR.send;

  XHR.open = function(method, url, ...rest) {
    this.__lam_url = url;
    return origOpen.call(this, method, url, ...rest);
  };
  XHR.send = function(...args) {
    const url = this.__lam_url || '';
    if (URL_PATTERN.test(url)) {
      const xhr = this;
      xhr.addEventListener('readystatechange', function onRsc() {
        if (xhr.readyState !== 4) return;
        try {
          const orig = xhr.responseText;
          const patched = filterMapResponse(orig);
          if (patched !== orig) {
            Object.defineProperty(xhr, 'responseText', { get: () => patched, configurable: true });
            Object.defineProperty(xhr, 'response',     { get: () => patched, configurable: true });
          }
        } catch (e) {
          console.warn('[lam] xhr patch error', e);
        }
      });
    }
    return origSend.apply(this, args);
  };

  // ---------- patch fetch (на всякий) ----------
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = async function(input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const resp = await origFetch.call(this, input, init);
      if (!URL_PATTERN.test(url)) return resp;
      try {
        const text = await resp.clone().text();
        const patched = filterMapResponse(text);
        if (patched === text) return resp;
        return new Response(patched, {
          status: resp.status, statusText: resp.statusText, headers: resp.headers,
        });
      } catch (e) {
        return resp;
      }
    };
  }

  // ---------- ymaps hooks ----------
  const collectIds = (obj, out = []) => {
    if (!obj || typeof obj !== 'object') return out;
    if (obj.id != null && /^\d+$/.test(String(obj.id))) out.push(String(obj.id));
    if (Array.isArray(obj)) {
      for (const v of obj) collectIds(v, out);
    } else {
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v && typeof v === 'object') collectIds(v, out);
      }
    }
    return out;
  };

  const normCoordKey = (lat, lng) => {
    const a = +lat, b = +lng;
    if (Number.isFinite(a) && Number.isFinite(b)) return `${a.toFixed(6)},${b.toFixed(6)}`;
    return null;
  };

  const coordsKey = (geom) => {
    if (Array.isArray(geom) && geom.length >= 2) return normCoordKey(geom[0], geom[1]);
    return null;
  };

  // ---------- mark apply ----------
  const applyMarkToPlacemark = (pm, idStr) => {
    if (!pm || !pm.options || typeof pm.options.set !== 'function') return;
    const status = STATE.marks[String(idStr)];
    if (!STATE.pmOrigPreset.has(pm)) {
      try { STATE.pmOrigPreset.set(pm, pm.options.get ? pm.options.get('preset') : undefined); } catch(_) {}
    }
    try {
      if (status === 'important' || status === 'medium') {
        pm.options.set('preset', PRESET[status]);
      } else if (status === 'hidden' && STATE.settings.showHidden) {
        pm.options.set('preset', PRESET.hidden);
      } else {
        const orig = STATE.pmOrigPreset.get(pm);
        pm.options.set('preset', orig);
      }
    } catch(e) {
      console.warn('[lam] applyMark error', e);
    }
  };

  // Реагируем на смену статуса конкретного объявления.
  // hidden + !showHidden → удалить с карты.
  // в остальных случаях → перекрасить (или вернуть оригинал).
  const handleStatusChange = (idStr) => {
    const status = STATE.marks[idStr];
    if (status === 'hidden' && !STATE.settings.showHidden) {
      removePlacemarkLive(idStr);
      return;
    }
    const set = STATE.pmById.get(idStr);
    if (!set || set.size === 0) {
      // если placemark был удалён ранее (hidden), а теперь сняли hidden или включили showHidden —
      // в clusterer'е его уже нет. Дёрнем bounds, чтобы list.am перезапросил карту.
      nudgeBounds();
      return;
    }
    for (const pm of set) applyMarkToPlacemark(pm, idStr);
  };

  // Срабатывает когда пользователь переключил «показывать скрытые» в popup.
  const onShowHiddenToggled = (prev, next) => {
    if (next) {
      // включаем показ — нужно вернуть скрытые placemark'и в clusterer.
      // фильтр уже не вырежет их при следующем запросе → дёрнем bounds.
      nudgeBounds();
    } else {
      // выключаем — пройдёмся по hidden id'ам и удалим из карты.
      for (const [id, status] of Object.entries(STATE.marks)) {
        if (status === 'hidden') removePlacemarkLive(String(id));
      }
    }
  };

  const nudgeBounds = () => {
    const map = STATE.map;
    if (!map || !map.getCenter || !map.setCenter) return;
    try {
      const c = map.getCenter();
      const z = map.getZoom();
      map.setCenter([c[0] + 1e-7, c[1] + 1e-7], z, { duration: 0, checkZoomRange: false });
      setTimeout(() => {
        try { map.setCenter(c, z, { duration: 0, checkZoomRange: false }); } catch(_) {}
      }, 50);
    } catch(_) {}
  };

  const registerPlacemark = (pm, geom, props, container) => {
    try {
      const ck = coordsKey(geom);
      const ids = new Set(collectIds(props));
      if (ck) {
        const fromCoords = STATE.coordsToIds.get(ck);
        if (fromCoords) for (const id of fromCoords) ids.add(String(id));
        if (!STATE.pmByCoord.has(ck)) STATE.pmByCoord.set(ck, new Set());
        STATE.pmByCoord.get(ck).add(pm);
      }
      if (container) STATE.pmContainer.set(pm, container);
      for (const id of ids) {
        if (!STATE.pmById.has(id)) STATE.pmById.set(id, new Set());
        STATE.pmById.get(id).add(pm);
        if (STATE.marks[id]) applyMarkToPlacemark(pm, id);
      }
    } catch(_) {}
  };

  // Хук Map / Placemark на каком угодно объекте ymaps.
  const installCtorHooks = (ymapsObj) => {
    try {
      if (ymapsObj.Map && !ymapsObj.Map.__lam_hooked) {
        const Orig = ymapsObj.Map;
        const Wrapped = new Proxy(Orig, {
          construct(t, a, nt) {
            const m = Reflect.construct(t, a, nt);
            STATE.map = m;
            // карта только что создана; placemark'и list.am добавит позже,
            // когда придёт ответ /aj-category-map. Подписка + retry harvest.
            try {
              if (m.geoObjects && m.geoObjects.events && typeof m.geoObjects.events.add === 'function') {
                m.geoObjects.events.add(['add','remove','change'], () => harvestExisting());
              }
            } catch(_) {}
            for (const ms of [200, 800, 2000, 5000]) setTimeout(harvestExisting, ms);
            return m;
          }
        });
        Object.defineProperty(Wrapped, '__lam_hooked', { value: true });
        try { ymapsObj.Map = Wrapped; } catch(_) {}
      }
      if (ymapsObj.Placemark && !ymapsObj.Placemark.__lam_hooked) {
        const Orig = ymapsObj.Placemark;
        const Wrapped = new Proxy(Orig, {
          construct(t, a, nt) {
            const pm = Reflect.construct(t, a, nt);
            registerPlacemark(pm, a[0], a[1]);
            return pm;
          }
        });
        Object.defineProperty(Wrapped, '__lam_hooked', { value: true });
        try { ymapsObj.Placemark = Wrapped; } catch(_) {}
      }
    } catch(_) {}
    return !!(ymapsObj.Map && ymapsObj.Map.__lam_hooked && ymapsObj.Placemark && ymapsObj.Placemark.__lam_hooked);
  };

  // Регистрируем все placemark'и внутри указанного контейнера (Clusterer или GeoObjectCollection).
  const harvestContainer = (container) => {
    if (!container) return;
    let arr = null;
    try {
      if (typeof container.getGeoObjects === 'function') arr = container.getGeoObjects();
    } catch(_) {}
    if (!arr) return;
    for (const go of arr) {
      try {
        const geom = go.geometry && go.geometry.getCoordinates && go.geometry.getCoordinates();
        const props = go.properties && go.properties.getAll && go.properties.getAll();
        registerPlacemark(go, geom, props, container);
      } catch(_) {}
    }
    // подпишемся на add/remove если у Clusterer есть события
    try {
      if (container.events && typeof container.events.add === 'function' && !container.__lam_listened) {
        container.events.add('parentchange', () => {});
        // ymaps Clusterer события: 'objectsaddtomap', 'add'
        // Универсально: при add на коллекции
        if (typeof container.add === 'function' && !container.__lam_addhooked) {
          const origAdd = container.add.bind(container);
          container.add = function(item) {
            try {
              const items = Array.isArray(item) ? item : [item];
              for (const go of items) {
                try {
                  const geom = go.geometry && go.geometry.getCoordinates && go.geometry.getCoordinates();
                  const props = go.properties && go.properties.getAll && go.properties.getAll();
                  registerPlacemark(go, geom, props, container);
                } catch(_) {}
              }
            } catch(_) {}
            return origAdd(item);
          };
          Object.defineProperty(container, '__lam_addhooked', { value: true });
        }
        Object.defineProperty(container, '__lam_listened', { value: true });
      }
    } catch(_) {}
    STATE.clusterers.add(container);
  };

  const harvestExisting = () => {
    if (!STATE.map || !STATE.map.geoObjects) return;
    try {
      STATE.map.geoObjects.each((go) => {
        // Если это Clusterer (или коллекция) — обойдём её содержимое.
        if (typeof go.getGeoObjects === 'function') {
          harvestContainer(go);
        } else {
          try {
            const geom = go.geometry && go.geometry.getCoordinates && go.geometry.getCoordinates();
            const props = go.properties && go.properties.getAll && go.properties.getAll();
            registerPlacemark(go, geom, props, STATE.map.geoObjects);
          } catch(_) {}
        }
      });
    } catch(_) {}
  };

  // Перехватываем window.ymaps через defineProperty на самом window:
  // когда Yandex API присваивает window.ymaps = X, наш set ловит X и оборачивает get.
  const installYmapsHook = () => {
    let real = window.ymaps;

    const onYmapsAssigned = () => {
      if (!real) return;
      // ставим хуки сразу
      installCtorHooks(real);
      // и через ymaps.ready — на случай если Map/Placemark инициализируются позже
      if (typeof real.ready === 'function') {
        try {
          real.ready(() => {
            installCtorHooks(real);
            harvestExisting();
          });
        } catch(_) {}
      }
    };

    if (real) { onYmapsAssigned(); return; }

    try {
      Object.defineProperty(window, 'ymaps', {
        configurable: true,
        get() { return real; },
        set(v) {
          real = v;
          onYmapsAssigned();
        }
      });
    } catch(e) {
      console.warn('[lam] cannot define ymaps getter, falling back to polling', e);
      let attempts = 0;
      const tick = () => {
        if (window.ymaps) { real = window.ymaps; onYmapsAssigned(); return; }
        if (++attempts < 600) setTimeout(tick, 10);
      };
      tick();
    }
  };
  installYmapsHook();

  // ---------- live actions ----------
  const removePlacemarkLive = (idStr) => {
    if (!STATE.map) return false;
    let set = STATE.pmById.get(idStr);

    if (!set || set.size === 0) {
      let foundCk = null;
      for (const [ck, ids] of STATE.coordsToIds.entries()) {
        if (ids.includes(idStr)) { foundCk = ck; break; }
      }
      if (foundCk) set = STATE.pmByCoord.get(foundCk);
    }

    if (!set || set.size === 0) return false;
    for (const pm of set) {
      const container = STATE.pmContainer.get(pm) || STATE.map.geoObjects;
      try { container.remove(pm); } catch(_) {}
    }
    STATE.pmById.delete(idStr);
    return true;
  };

  // Перепрогон уже собранных контейнеров — на случай если placemarks добавились между
  // первым harvest'ом и MARKS_PUSH'ом.
  const reharvestAll = () => {
    for (const c of STATE.clusterers) harvestContainer(c);
    if (STATE.clusterers.size === 0) harvestExisting();
  };

})();
