chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('popup.html');
  const windows = await chrome.windows.getAll({populate: true, windowTypes: ['popup']});
  const existing = windows.find(window => window.tabs?.some(tab => tab.url === url));
  if (existing?.id != null) {
    await chrome.windows.update(existing.id, {focused: true, state: 'normal'});
  } else {
    await chrome.windows.create({url, type: 'popup', width: 1200, height: 800, focused: true});
  }
});
