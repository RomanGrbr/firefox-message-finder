document.addEventListener('DOMContentLoaded', async () => {
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const toggleBtn = document.getElementById('togglePause');
  const statCommented = document.getElementById('statCommented');
  const statSkipped = document.getElementById('statSkipped');
  const statIgnored = document.getElementById('statIgnored');
  const queueLength = document.getElementById('queueLength');
  const waitingStatus = document.getElementById('waitingStatus');
  const logLevelSelect = document.getElementById('logLevel');
  const commentProbInput = document.getElementById('commentProbability');
  const autoPauseCheck = document.getElementById('autoPause');
  const saveBtn = document.getElementById('saveSettings');

  // Устанавливаем долгоживущее соединение с background
  const port = browser.runtime.connect({ name: 'popup' });
  
  // Слушаем обновления от background
  port.onMessage.addListener((msg) => {
    console.log('popup: получено обновление', msg);
    if (msg.type === 'STATE_UPDATED') {
      updateUI(msg.paused);
      logLevelSelect.value = msg.settings.logLevel;
      commentProbInput.value = msg.settings.commentProbability;
      autoPauseCheck.checked = msg.settings.autoPauseAfterComment;
    }
  });

  // Загружаем начальное состояние
  try {
    const state = await browser.runtime.sendMessage({ type: 'GET_STATE' });
    updateUI(state.paused);
    logLevelSelect.value = state.settings.logLevel;
    commentProbInput.value = state.settings.commentProbability;
    autoPauseCheck.checked = state.settings.autoPauseAfterComment;
  } catch (e) {
    console.error('Ошибка загрузки состояния:', e);
  }

  // Загружаем статистику из активной вкладки
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      const stats = await browser.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' });
      if (stats && !stats.error) {
        statCommented.textContent = stats.stats.commented;
        statSkipped.textContent = stats.stats.skipped;
        statIgnored.textContent = stats.stats.ignored;
        queueLength.textContent = stats.queueLength;
        waitingStatus.textContent = stats.waitingForCooldown ? 'да (5 мин)' : 'нет';
      }
    }
  } catch (e) {
    console.log('content script ещё не готов');
  }

  toggleBtn.addEventListener('click', async () => {
    try {
      const newState = await browser.runtime.sendMessage({ type: 'TOGGLE_PAUSE' });
      updateUI(newState.paused);
    } catch (e) {
      console.error('Ошибка переключения паузы:', e);
    }
  });

  saveBtn.addEventListener('click', async () => {
    const newSettings = {
      logLevel: parseInt(logLevelSelect.value, 10),
      commentProbability: parseInt(commentProbInput.value, 10),
      autoPauseAfterComment: autoPauseCheck.checked
    };
    
    try {
      await browser.runtime.sendMessage({ 
        type: 'UPDATE_SETTINGS', 
        settings: newSettings 
      });
      
      saveBtn.textContent = 'Сохранено!';
      setTimeout(() => { 
        saveBtn.textContent = 'Сохранить настройки'; 
      }, 1000);
    } catch (e) {
      console.error('Ошибка сохранения:', e);
    }
  });

  // Периодически обновляем статистику (каждые 5 секунд)
  setInterval(async () => {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        const stats = await browser.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' });
        if (stats && !stats.error) {
          statCommented.textContent = stats.stats.commented;
          statSkipped.textContent = stats.stats.skipped;
          statIgnored.textContent = stats.stats.ignored;
          queueLength.textContent = stats.queueLength;
          waitingStatus.textContent = stats.waitingForCooldown ? 'да (5 мин)' : 'нет';
        }
      }
    } catch (e) {
      // Игнорируем ошибки при обновлении
    }
  }, 5000);

  function updateUI(paused) {
    if (paused) {
      statusIndicator.className = 'indicator red';
      statusText.textContent = 'На паузе';
      toggleBtn.textContent = 'Возобновить';
    } else {
      statusIndicator.className = 'indicator green';
      statusText.textContent = 'Активно';
      toggleBtn.textContent = 'Приостановить';
    }
  }
});