const KEY = 'marks';

const render = async () => {
  const r = await chrome.storage.local.get(KEY);
  const marks = r[KEY] || {};
  const counts = { important: 0, medium: 0, hidden: 0 };
  for (const v of Object.values(marks)) if (counts[v] != null) counts[v]++;
  document.getElementById('stats').innerHTML = `
    <div class="row"><span>★ Важное</span><b>${counts.important}</b></div>
    <div class="row"><span>• Среднее</span><b>${counts.medium}</b></div>
    <div class="row"><span>⊘ Скрыто</span><b>${counts.hidden}</b></div>
    <div class="row"><span>Всего записей</span><b>${Object.keys(marks).length}</b></div>
  `;
};

document.getElementById('export').addEventListener('click', async () => {
  const r = await chrome.storage.local.get(KEY);
  const blob = new Blob([JSON.stringify(r[KEY] || {}, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `list-am-marks-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('clear').addEventListener('click', async () => {
  if (!confirm('Удалить все метки?')) return;
  await chrome.storage.local.set({ [KEY]: {} });
  render();
});

render();
