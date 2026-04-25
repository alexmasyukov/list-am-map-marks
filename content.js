// content.js — isolated world.
// 1) Инжектит injected.js в MAIN world (нужен monkey-patch XHR/fetch и доступ к ymaps).
// 2) Слушает MutationObserver'ом #mapinfo и вставляет в него три кнопки.
// 3) Хранит/раздаёт состояние через chrome.storage.local.
// 4) Общается с injected.js через window.postMessage (одноимённое окно).

(() => {
  const STORAGE_KEY = 'marks';
  const STATUSES = {
    important: { label: '★ Важное', cls: 'lam-important' },
    medium:    { label: '• Среднее', cls: 'lam-medium' },
    hidden:    { label: '⊘ Скрыть с карты', cls: 'lam-hidden' },
  };

  // ---------- inject MAIN-world script ----------
  const injectMainWorld = () => {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('injected.js');
    s.async = false;
    (document.head || document.documentElement).appendChild(s);
    s.onload = () => s.remove();
  };
  injectMainWorld();

  // ---------- storage ----------
  let marksCache = {};
  const loadMarks = async () => {
    const r = await chrome.storage.local.get(STORAGE_KEY);
    marksCache = r[STORAGE_KEY] || {};
    pushMarksToMain();
    return marksCache;
  };
  const saveMark = async (id, status) => {
    if (status == null) delete marksCache[id];
    else marksCache[id] = status;
    await chrome.storage.local.set({ [STORAGE_KEY]: marksCache });
    pushMarksToMain();
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      marksCache = changes[STORAGE_KEY].newValue || {};
      pushMarksToMain();
      refreshButtonsForCurrentMapinfo();
    }
  });

  // ---------- MAIN <-> ISOLATED bridge ----------
  const MSG = {
    MARKS_PUSH: 'lam:marks-push',
    MARK_HIDDEN_ID: 'lam:mark-hidden',
    MARK_UPDATE_ID: 'lam:mark-update',
    MAIN_READY: 'lam:main-ready',
  };
  const pushMarksToMain = () => {
    window.postMessage({ source: 'lam-content', type: MSG.MARKS_PUSH, marks: marksCache }, '*');
  };
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== 'lam-injected') return;
    if (d.type === MSG.MAIN_READY) pushMarksToMain();
  });

  // ---------- mapinfo UI ----------
  const parseItemIdFromMapinfo = (mapinfo) => {
    const a = mapinfo.querySelector('a[href*="/item/"]');
    if (!a) return null;
    const m = a.getAttribute('href').match(/\/item\/(\d+)/);
    return m ? m[1] : null;
  };

  const refreshButtonsForCurrentMapinfo = () => {
    const mapinfo = document.getElementById('mapinfo');
    if (!mapinfo) return;
    const id = parseItemIdFromMapinfo(mapinfo);
    const bar = mapinfo.querySelector('.lam-bar');
    if (!bar || !id) return;
    const current = marksCache[id] || null;
    bar.querySelectorAll('button[data-status]').forEach(btn => {
      btn.classList.toggle('lam-active', btn.dataset.status === current);
    });
  };

  const ensureButtonsInMapinfo = (mapinfo) => {
    if (!mapinfo) return;
    const id = parseItemIdFromMapinfo(mapinfo);
    if (!id) return;

    let bar = mapinfo.querySelector('.lam-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'lam-bar';
      bar.addEventListener('click', (e) => {
        // Защита от всплытия в обёртку <a>
        e.stopPropagation();
        e.preventDefault();
      });

      for (const [status, meta] of Object.entries(STATUSES)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `lam-btn ${meta.cls}`;
        btn.dataset.status = status;
        btn.textContent = meta.label;
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          e.preventDefault();
          const itemId = parseItemIdFromMapinfo(mapinfo);
          if (!itemId) return;
          // Тогл: если уже стоит — снимаем
          const current = marksCache[itemId] || null;
          const next = current === status ? null : status;
          await saveMark(itemId, next);

          if (next === 'hidden') {
            window.postMessage({ source: 'lam-content', type: MSG.MARK_HIDDEN_ID, id: itemId }, '*');
            mapinfo.style.display = 'none';
          } else {
            // important/medium/null — обновим карту: list.am перезапросит точки и наш patch
            // вернёт label с префиксом ★/•, по которому CSS подсветит метку.
            window.postMessage({ source: 'lam-content', type: MSG.MARK_UPDATE_ID, id: itemId }, '*');
          }
        });
        bar.appendChild(btn);
      }
      mapinfo.appendChild(bar);
    }
    refreshButtonsForCurrentMapinfo();
  };

  // Наблюдаем за появлением/обновлением #mapinfo (он живёт всегда, но содержимое меняется)
  const observeMapinfo = () => {
    const tryAttach = () => {
      const mapinfo = document.getElementById('mapinfo');
      if (mapinfo) ensureButtonsInMapinfo(mapinfo);
    };
    // первичная попытка
    tryAttach();
    // глобальный observer на body — чтобы поймать момент когда mapinfo появится/перерисуется
    const mo = new MutationObserver(() => tryAttach());
    mo.observe(document.documentElement, { childList: true, subtree: true });
  };

  // ---------- start ----------
  const start = async () => {
    await loadMarks();
    observeMapinfo();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
