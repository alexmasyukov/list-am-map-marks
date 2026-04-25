const MARKS = 'marks';
const SETTINGS = 'settings';
const DEFAULTS = { showHidden: false };

const $ = (id) => document.getElementById(id);

const renderStats = (marks) => {
  const counts = { important: 0, medium: 0, hidden: 0 };
  for (const v of Object.values(marks)) if (counts[v] != null) counts[v]++;
  $('stats').innerHTML = `
    <div class="row"><span>★ Важное</span><b>${counts.important}</b></div>
    <div class="row"><span>• Среднее</span><b>${counts.medium}</b></div>
    <div class="row"><span>⊘ Скрыто</span><b>${counts.hidden}</b></div>
    <div class="row"><span>Всего записей</span><b>${Object.keys(marks).length}</b></div>
  `;
};

const init = async () => {
  const r = await chrome.storage.local.get([MARKS, SETTINGS]);
  const marks = r[MARKS] || {};
  const settings = Object.assign({}, DEFAULTS, r[SETTINGS] || {});
  renderStats(marks);
  $('showHidden').checked = !!settings.showHidden;
};

$('showHidden').addEventListener('change', async (e) => {
  const r = await chrome.storage.local.get(SETTINGS);
  const settings = Object.assign({}, DEFAULTS, r[SETTINGS] || {});
  settings.showHidden = e.target.checked;
  await chrome.storage.local.set({ [SETTINGS]: settings });
});

$('export').addEventListener('click', async () => {
  const r = await chrome.storage.local.get([MARKS, SETTINGS]);
  const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `list-am-marks-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$('clear').addEventListener('click', async () => {
  if (!confirm('Удалить все метки? Настройка «показывать скрытые» сохранится.')) return;
  await chrome.storage.local.set({ [MARKS]: {} });
  init();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[MARKS]) renderStats(changes[MARKS].newValue || {});
  if (changes[SETTINGS]) $('showHidden').checked = !!(changes[SETTINGS].newValue || {}).showHidden;
});

init();
