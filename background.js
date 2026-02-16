// background.js
let isPaused = false;
let settings = {
  logLevel: 1,
  commentProbability: 70,
  autoPauseAfterComment: false
};

// Храним активные popup для обновления
let activePopups = new Set();

browser.storage.local.get(['isPaused', 'settings']).then(result => {
  if (result.isPaused !== undefined) isPaused = result.isPaused;
  if (result.settings) settings = { ...settings, ...result.settings };
  updateIcon();
  console.log('background: загружено состояние', { isPaused, settings });
});

function updateIcon() {
  const iconPath = isPaused ? 'icons/pause.png' : 'icons/active.png';
  const title = isPaused ? 'На паузе' : 'Активно';
  browser.browserAction.setIcon({ path: iconPath });
  browser.browserAction.setTitle({ title });
}

function setPaused(value) {
  if (isPaused === value) return;
  isPaused = value;
  browser.storage.local.set({ isPaused });
  updateIcon();
  console.log(`background: пауза изменена на ${isPaused}`);
  
  // Рассылаем всем вкладкам
  browser.tabs.query({}).then(tabs => {
    const msg = { type: isPaused ? 'PAUSE' : 'RESUME' };
    tabs.forEach(tab => {
      browser.tabs.sendMessage(tab.id, msg).catch(() => {});
    });
  });
  
  // Уведомляем все открытые popup
  notifyPopups();
}

function updateSettings(newSettings) {
  settings = { ...settings, ...newSettings };
  browser.storage.local.set({ settings });
  console.log('background: настройки обновлены', settings);
  
  browser.tabs.query({}).then(tabs => {
    const msg = { type: 'SETTINGS_UPDATED', settings };
    tabs.forEach(tab => browser.tabs.sendMessage(tab.id, msg).catch(() => {}));
  });
  
  // Уведомляем все открытые popup
  notifyPopups();
}

function notifyPopups() {
  activePopups.forEach(popupPort => {
    try {
      popupPort.postMessage({
        type: 'STATE_UPDATED',
        paused: isPaused,
        settings: settings
      });
    } catch (e) {
      activePopups.delete(popupPort);
    }
  });
}

// Обработка сообщений от popup и content
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('background: получено сообщение', msg.type, msg);
  
  if (msg.type === 'GET_STATE') {
    sendResponse({ paused: isPaused, settings });
  }
  else if (msg.type === 'TOGGLE_PAUSE') {
    setPaused(!isPaused);
    sendResponse({ paused: isPaused, settings });
  }
  else if (msg.type === 'UPDATE_SETTINGS') {
    updateSettings(msg.settings);
    sendResponse({ settings });
  }
  else if (msg.type === 'STATUS_UPDATED') {
    // Обновляем статус из content script
    if (msg.status && msg.status.paused !== undefined) {
      setPaused(msg.status.paused);
    }
    sendResponse({ received: true });
  }
});

// Обработка долгоживущих соединений от popup
browser.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    console.log('background: popup подключился');
    activePopups.add(port);
    
    port.onDisconnect.addListener(() => {
      console.log('background: popup отключился');
      activePopups.delete(port);
    });
    
    // Сразу отправляем текущее состояние
    port.postMessage({
      type: 'STATE_UPDATED',
      paused: isPaused,
      settings: settings
    });
  }
});