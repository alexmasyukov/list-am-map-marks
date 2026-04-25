// Минимальный SW — пока только лог установки. Позже сюда можно перенести
// унификацию storage / экспорт / синк.
chrome.runtime.onInstalled.addListener(() => {
  console.log('[list-am-marks] installed');
});
