console.log('🔥 Message Finder: расширение загружено!');

// ==================== КОНСТАНТЫ НАСТРОЕК ====================
const DEFAULT_LOG_LEVEL = 1;
const DEFAULT_COMMENT_PROBABILITY = 70; // %
const DEFAULT_AUTO_PAUSE = false;

const COMMENT_COOLDOWN = 300000; // 5 минут
const RENDER_DELAYS = {
  INIT: 1000,
  HOVER: 800,
  PANEL: 2000,
  INPUT: 500,
  SUBMIT: 1000
};

const SKIP_MIN = 4;
const SKIP_MAX = 6;

// ==================== ЛОГГЕР ====================
class Logger {
  constructor(initialLevel = DEFAULT_LOG_LEVEL) {
    this.level = initialLevel;
  }
  setLevel(level) { this.level = level; }
  info(...args) { if (this.level >= 1) console.log('📘', ...args); }
  debug(...args) { if (this.level >= 2) console.log('🔍', ...args); }
  warn(...args) { console.warn('⚠️', ...args); }
  error(...args) { console.error('❌', ...args); }
  success(...args) { if (this.level >= 1) console.log('✅', ...args); }
  stat(...args) { if (this.level >= 1) console.log('📊', ...args); }
}

const log = new Logger();

// ==================== УТИЛИТЫ ====================
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== ИЗВЛЕЧЕНИЕ ДАННЫХ ====================
class DataExtractor {
  static getMessageId(element) {
    return parseInt(element.getAttribute('data-message-id'));
  }

  static getMessageNumber(text) {
    const match = text.match(/\[(\d+)\]/);
    return match ? parseInt(match[1]) : null;
  }

  static getMessageEmail(text) {
    const match = text.match(/\(([^)]+@[^)]+)\)/);
    return match ? match[1] : null;
  }

  static getMessageAuthor(element) {
    const authorEl = element.querySelector('.text-foreground.cursor-pointer');
    return authorEl ? authorEl.textContent.trim() : '';
  }

  static hasCommentsIndicator(element) {
    return element.querySelector('.flex.flex-wrap.gap-1 button') !== null;
  }

  static getMessageText(element) {
    const textEl = element.querySelector('.markup p');
    return textEl ? textEl.textContent.trim() : '';
  }
}

// ==================== ВЗАИМОДЕЙСТВИЕ С UI ====================
class UIManager {
  async hoverMessage(element) {
    element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
    await delay(RENDER_DELAYS.HOVER);
  }

  async openCommentPanel(messageElement) {
    await this.hoverMessage(messageElement);

    let buttonContainer = messageElement.querySelector('div[class*="group-hover/message"]') ||
                         messageElement.querySelector('div[class*="group-hover"][class*="hidden"]');
    if (!buttonContainer) return null;

    const buttons = buttonContainer.querySelectorAll('button');
    if (buttons.length === 0) return null;

    let commentButton = null;
    for (let btn of buttons) {
      const ariaLabel = btn.getAttribute('aria-label');
      if (ariaLabel?.includes('thread') || ariaLabel?.includes('Discuss')) {
        commentButton = btn;
        break;
      }
    }
    if (!commentButton && buttons.length >= 2) commentButton = buttons[1];
    if (!commentButton) return null;

    commentButton.click();
    await delay(RENDER_DELAYS.PANEL);

    const panel = document.querySelector('div[class*="box-border"][class*="min-w-[350px]"]');
    return panel;
  }

  getMessagesInPanel(panel) {
    return panel.querySelectorAll('div[data-message-id]');
  }

  getLastMessageInPanel(panel) {
    const messages = this.getMessagesInPanel(panel);
    if (messages.length === 0) return null;
    let maxId = -1;
    let last = null;
    messages.forEach(msg => {
      const id = DataExtractor.getMessageId(msg);
      if (id > maxId) {
        maxId = id;
        last = msg;
      }
    });
    return last;
  }

  async closePanel(panel) {
    const closeButton = panel.querySelector('button svg.lucide-x')?.closest('button');
    if (closeButton) {
      closeButton.click();
      await delay(200);
    }
  }

  async enterComment(panel, text) {
    const editableDiv = panel.querySelector('div[contenteditable="true"].ProseMirror');
    if (!editableDiv) return false;

    editableDiv.focus();
    editableDiv.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = text;
    editableDiv.appendChild(p);
    editableDiv.dispatchEvent(new Event('input', { bubbles: true }));
    await delay(RENDER_DELAYS.INPUT);
    return true;
  }

  async submitComment(panel) {
    const sendButton = panel.querySelector('button[class*="bg-primary"]');
    if (sendButton) {
      sendButton.click();
      await delay(RENDER_DELAYS.SUBMIT);
      return true;
    } else {
      const editableDiv = panel.querySelector('div[contenteditable="true"].ProseMirror');
      if (editableDiv) {
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          bubbles: true, cancelable: true
        });
        editableDiv.dispatchEvent(enterEvent);
        await delay(RENDER_DELAYS.SUBMIT);
        return true;
      }
    }
    return false;
  }
}

// ==================== ВАЛИДАЦИЯ ====================
class MessageValidator {
  isValidNumber(number) {
    if (number === null) return false;
    return number !== 1 && number !== 20;
  }
}

// ==================== WEBSOCKET КЛИЕНТ ====================
class WebSocketClient {
  constructor(messageFinder) {
    this.messageFinder = messageFinder;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 3000;
    this.connect();
  }

  connect() {
    try {
      console.log('🔄 Попытка подключения к WebSocket серверу...');
      this.ws = new WebSocket('ws://localhost:8765');
      
      this.ws.onopen = () => {
        console.log('✅ WebSocket подключен к серверу');
        console.log('📊 Отправляем начальную статистику...');
        this.reconnectAttempts = 0;
        
        // Отправляем статистику сразу после подключения
        setTimeout(() => {
          this.sendStats();
          this.sendLog(1, 'WebSocket подключен');
        }, 500);
      };
      
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📩 Получена команда от сервера:', data);
          
          if (data.type === 'connected') {
            console.log('🖐️ Сервер подтвердил подключение:', data.message);
            this.sendStats();
          } else {
            this.handleCommand(data);
          }
        } catch (e) {
          console.error('❌ Ошибка парсинга сообщения:', e);
        }
      };
      
      this.ws.onclose = (event) => {
        console.log(`🔌 WebSocket отключен. Код: ${event.code}, Причина: ${event.reason || 'нет'}`);
        this.reconnect();
      };
      
      this.ws.onerror = (error) => {
        console.error('❌ WebSocket ошибка:', error);
      };
      
    } catch (e) {
      console.error('❌ Ошибка подключения WebSocket:', e);
      this.reconnect();
    }
  }

  reconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`🔄 Попытка переподключения ${this.reconnectAttempts}/${this.maxReconnectAttempts} через ${this.reconnectDelay/1000}с...`);
      setTimeout(() => this.connect(), this.reconnectDelay);
    } else {
      console.log('❌ Превышено количество попыток переподключения');
    }
  }

  sendStatusUpdate() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    try {
        const status = this.messageFinder.getStatus();
        this.ws.send(JSON.stringify({
        type: 'status_update',
        paused: status.paused
        }));
        console.log('📤 Отправлен статус паузы:', status.paused);
    } catch (e) {
        console.error('❌ Ошибка отправки статуса:', e);
    }
    }

  handleCommand(data) {
    const mf = this.messageFinder;
    if (!mf) return;
    
    switch (data.type) {
      case 'pause':
        console.log('⏸️ Получена команда паузы');
        mf.pause();
        break;
      case 'resume':
        console.log('▶️ Получена команда возобновления');
        mf.resume();
        break;
      case 'setLogLevel':
        if (data.level !== undefined) {
          console.log(`📊 Устанавливаем уровень логов: ${data.level}`);
          if (mf.log && mf.log.setLevel) {
            mf.log.setLevel(data.level);
          }
        }
        break;
      case 'setProbability':
        if (data.value !== undefined) {
          console.log(`🎲 Устанавливаем вероятность: ${data.value}%`);
          mf.commentProbability = data.value / 100;
        }
        break;
      case 'setAutoPause':
        if (data.value !== undefined) {
          console.log(`⏸️ Устанавливаем автопаузу: ${data.value}`);
          mf.autoPauseAfterComment = data.value;
        }
        break;
      case 'requestStats':
        console.log('📊 Запрос статистики от сервера');
        this.sendStats();
        break;
      default:
        console.log('Неизвестная команда:', data.type);
    }
  }

  sendComment(commentData) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('❌ WebSocket не подключен, комментарий не отправлен');
      return;
    }
    
    try {
      const message = JSON.stringify({
        type: 'comment',
        data: commentData
      });
      this.ws.send(message);
      console.log('📤 Отправлен комментарий в WebSocket');
    } catch (e) {
      console.error('❌ Ошибка отправки комментария:', e);
    }
  }

  sendStats() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('❌ WebSocket не подключен, статистика не отправлена');
      return;
    }
    
    try {
      if (this.messageFinder) {
        const status = this.messageFinder.getStatus();
        const message = JSON.stringify({
          type: 'stats',
          data: status.stats
        });
        this.ws.send(message);
        console.log('📊 Отправлена статистика в WebSocket:', status.stats);
      }
    } catch (e) {
      console.error('❌ Ошибка отправки статистики:', e);
    }
  }

  sendLog(level, message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    try {
      this.ws.send(JSON.stringify({
        type: 'log',
        level: level,
        message: message,
        timestamp: Date.now()
      }));
    } catch (e) {
      console.error('❌ Ошибка отправки лога:', e);
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// ==================== ОСНОВНОЙ КЛАСС ====================
class MessageFinder {
  constructor() {
    this.lastMessageId = 0;
    this.initialMaxId = 0;
    this.messageSelector = 'div[data-message-id]';
    this.initializationComplete = false;

    this.commentedHistory = [];
    this.maxHistorySize = 10;
    this.messageCounter = 0;
    this.skipCounter = this.getRandomSkip();

    this.ui = new UIManager();
    this.validator = new MessageValidator();
    
    // WebSocket клиент
    this.wsClient = new WebSocketClient(this);

    // Логика ожидания
    this.waitingForCooldown = false;
    this.myCommentedIds = new Set();
    this.pendingMessage = null;
    this.pendingTimeout = null;
    this.messageQueue = [];
    this.indicatorObserver = null;

    // Статистика
    this.stats = { commented: 0, skipped: 0, ignored: 0 };

    // Состояние паузы
    this.paused = false;

    // Настройки
    this.commentProbability = DEFAULT_COMMENT_PROBABILITY / 100;
    this.autoPauseAfterComment = DEFAULT_AUTO_PAUSE;

    this.detectedTimes = new Map();

    this.loadHistory();
    this.loadSettings();
    this.initialize();

    // Слушаем команды из background
    browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      console.log('content: получено сообщение', msg);
      if (msg.type === 'PAUSE') {
        this.pause();
        sendResponse({ status: 'paused' });
      } else if (msg.type === 'RESUME') {
        this.resume();
        sendResponse({ status: 'resumed' });
      } else if (msg.type === 'GET_STATS') {
        sendResponse(this.stats);
      } else if (msg.type === 'SETTINGS_UPDATED') {
        this.applySettings(msg.settings);
      }
    });
  }

  // ВСЕ МЕТОДЫ ДОЛЖНЫ БЫТЬ ВНУТРИ КЛАССА
  getRandomSkip() {
    return Math.floor(Math.random() * (SKIP_MAX - SKIP_MIN + 1)) + SKIP_MIN;
  }

  async loadSettings() {
    try {
      const result = await browser.storage.local.get('settings');
      if (result.settings) {
        this.applySettings(result.settings);
      }
    } catch (e) {
      log.error('Ошибка загрузки настроек:', e);
    }
  }

  applySettings(settings) {
    if (settings.logLevel !== undefined) {
      log.setLevel(settings.logLevel);
      log.info(`Уровень логирования установлен: ${settings.logLevel}`);
    }
    if (settings.commentProbability !== undefined) {
      this.commentProbability = settings.commentProbability / 100;
      log.info(`Вероятность комментирования: ${this.commentProbability * 100}%`);
    }
    if (settings.autoPauseAfterComment !== undefined) {
      this.autoPauseAfterComment = settings.autoPauseAfterComment;
      log.info(`Автопауза после комментария: ${this.autoPauseAfterComment ? 'вкл' : 'выкл'}`);
    }
  }

  async initialize() {
    await delay(RENDER_DELAYS.INIT);
    this.findMaxMessageId();
  }

  findMaxMessageId() {
    const blocks = document.querySelectorAll(this.messageSelector);
    if (blocks.length === 0) {
      this.initialMaxId = 0;
      this.initializationComplete = true;
      this.observeNewMessages();
      return;
    }

    let maxId = -1;
    let latest = null;
    blocks.forEach(block => {
      const id = DataExtractor.getMessageId(block);
      if (id > maxId) {
        maxId = id;
        latest = block;
      }
    });

    this.initialMaxId = maxId;
    this.lastMessageId = maxId;
    this.markAsLatest(latest);
    this.initializationComplete = true;
    this.observeNewMessages();
  }

  markAsLatest(element) {
    this.clearMarks();
    if (window.getComputedStyle(element).position === 'static') {
      element.style.position = 'relative';
    }
    element.style.border = '2px solid #0000ff';

    const label = document.createElement('span');
    label.className = 'message-finder-label';
    label.textContent = '🔵 ПОСЛЕДНЕЕ';
    label.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      background: #0000ff;
      color: white;
      padding: 2px 5px;
      font-size: 11px;
      z-index: 10000;
      border-radius: 0 0 5px 0;
      pointer-events: none;
    `;
    element.appendChild(label);
  }

  observeNewMessages() {
    const observer = new MutationObserver(mutations => {
      if (!this.initializationComplete || this.paused) return;
      let newMessages = [];
      mutations.forEach(mut => {
        if (mut.addedNodes.length) {
          mut.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.matches?.(this.messageSelector)) {
                newMessages.push(node);
              }
              const inner = node.querySelectorAll?.(this.messageSelector) || [];
              if (inner.length) newMessages.push(...inner);
            }
          });
        }
      });
      if (newMessages.length) this.processNewMessages(newMessages);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async processNewMessages(messages) {
    for (const el of messages) {
      const id = DataExtractor.getMessageId(el);
      if (id <= this.initialMaxId) continue;

      if (!this.detectedTimes.has(id)) {
        this.detectedTimes.set(id, Date.now());
      }

      if (id <= this.lastProcessedId) continue;
      this.lastProcessedId = id;
      this.lastMessageId = id;

      this.messageCounter++;
      if (this.messageCounter % this.skipCounter === 0) {
        this.skipCounter = this.getRandomSkip();
        this.stats.skipped++;
        log.info(`⏭️ Пропущено по счётчику (сообщение #${this.messageCounter})`);
        continue;
      }

      if (this.pendingMessage) {
        this.messageQueue.push(el);
        continue;
      }

      await this.handleNewMessage(el);
    }
  }

  async handleNewMessage(element) {
    const text = DataExtractor.getMessageText(element);
    const number = DataExtractor.getMessageNumber(text);
    const hasComments = DataExtractor.hasCommentsIndicator(element);
    const id = DataExtractor.getMessageId(element);

    if (hasComments && !this.myCommentedIds.has(id)) {
      if (this.pendingMessage && DataExtractor.getMessageId(this.pendingMessage) === id) {
        this.cancelWaiting();
        log.info(`🔔 Чужой комментарий на ожидаемом сообщении #${id}, ожидание отменено`);
      }
      this.stats.ignored++;
      return;
    }

    if (!this.validator.isValidNumber(number)) {
      this.stats.ignored++;
      return;
    }

    if (Math.random() > this.commentProbability) {
      this.stats.skipped++;
      log.info(`🎲 Случайный пропуск (вероятность ${this.commentProbability * 100}%)`);
      return;
    }

    if (this.waitingForCooldown) {
      const detectedTime = this.detectedTimes.get(id);
      const timePassed = Date.now() - detectedTime;
      const waitTime = Math.max(0, COMMENT_COOLDOWN - timePassed);

      if (waitTime > 0) {
        this.pendingMessage = element;
        log.info(`⏳ Ожидание ${Math.round(waitTime / 1000)}с перед комментированием`);

        this.watchForCommentIndicator(element, id);

        this.pendingTimeout = setTimeout(async () => {
          const hasCommentsNow = DataExtractor.hasCommentsIndicator(element);
          if (hasCommentsNow) {
            this.cancelWaiting();
            await this.processQueue();
            return;
          }

          await this.commentOnMessage(element);
          this.pendingMessage = null;
          this.pendingTimeout = null;
          if (this.indicatorObserver) {
            this.indicatorObserver.disconnect();
            this.indicatorObserver = null;
          }
          await this.processQueue();
        }, waitTime);
      } else {
        await this.commentOnMessage(element);
      }
    } else {
      await this.commentOnMessage(element);
    }
  }

  async commentOnMessage(element) {
    const panel = await this.ui.openCommentPanel(element);
    if (!panel) return false;

    const messagesInPanel = this.ui.getMessagesInPanel(panel);
    if (messagesInPanel.length > 1) {
      await this.ui.closePanel(panel);
      return false;
    }

    const success = await this.ui.enterComment(panel, '+');
    if (success) {
        await this.ui.submitComment(panel);
        const id = DataExtractor.getMessageId(element);
        const text = DataExtractor.getMessageText(element);
        const link = element.querySelector('a[href*="st.yandex-team.ru"]')?.href || '';
        const number = DataExtractor.getMessageNumber(text);
        const author = DataExtractor.getMessageAuthor(element);
        const email = DataExtractor.getMessageEmail(text);
        
        this.myCommentedIds.add(id);
        this.waitingForCooldown = true;
        this.stats.commented++;
        
        this.wsClient.sendComment({
            id: id,
            text: text,
            link: link,
            number: number,
            author: author,
            email: email,
            timestamp: Date.now()
        });
        
        this.wsClient.sendStats();
        this.wsClient.sendLog(1, `Прокомментировано сообщение ID ${id}`);
        
        if (this.autoPauseAfterComment) {
            log.info('⏸️ Автопауза после комментария');
            this.pause();
        }
    }

    await this.ui.closePanel(panel);
    return success;
  }

  watchForCommentIndicator(element, messageId) {
    if (this.indicatorObserver) this.indicatorObserver.disconnect();
    this.indicatorObserver = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        if (mut.addedNodes.length) {
          for (const node of mut.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.matches?.('.flex.flex-wrap.gap-1 button') || node.querySelector?.('.flex.flex-wrap.gap-1 button')) {
                log.debug(`👀 Замечен чужой комментарий на сообщении #${messageId}`);
                this.cancelWaiting();
                return;
              }
            }
          }
        }
      }
    });
    this.indicatorObserver.observe(element, { childList: true, subtree: true });
  }

  cancelWaiting() {
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
    if (this.indicatorObserver) {
      this.indicatorObserver.disconnect();
      this.indicatorObserver = null;
    }
    this.pendingMessage = null;
    this.waitingForCooldown = false;
    log.info('⏹️ Ожидание отменено');
  }

  async processQueue() {
    while (this.messageQueue.length > 0 && !this.pendingMessage && !this.paused) {
      const next = this.messageQueue.shift();
      await this.handleNewMessage(next);
    }
  }

  sendStatusToPopup() {
    try {
        browser.runtime.sendMessage({
        type: 'STATUS_UPDATED',
        status: this.getStatus()
        }).catch(() => {
        // Popup может быть закрыт - игнорируем
        });
    } catch (e) {
        // Игнорируем ошибки
    }
    }

  pause() {
    if (this.paused) return;
    this.paused = true;
    if (this.pendingTimeout) {
        clearTimeout(this.pendingTimeout);
        this.pendingTimeout = null;
    }
    if (this.indicatorObserver) {
        this.indicatorObserver.disconnect();
        this.indicatorObserver = null;
    }
    console.log('content: расширение на паузе');
    log.info('⏸️ Расширение на паузе');
    
    // Отправляем статус в WebSocket
    if (this.wsClient) {
        this.wsClient.sendStatusUpdate();
    }
    
    // Отправляем статус в popup
    this.sendStatusToPopup();
    }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    console.log('content: работа возобновлена');
    log.info('▶️ Работа возобновлена');
    this.processQueue();
    
    // Отправляем статус в WebSocket
    if (this.wsClient) {
        this.wsClient.sendStatusUpdate();
    }
    
    // Отправляем статус в popup
    this.sendStatusToPopup();
    }

  loadHistory() {
    try {
      const saved = localStorage.getItem('messageFinderHistory');
      if (saved) this.commentedHistory = JSON.parse(saved);
    } catch (e) {}
  }

  saveHistory() {
    try {
      localStorage.setItem('messageFinderHistory', JSON.stringify(this.commentedHistory));
    } catch (e) {}
  }

  addToHistory(data) {
    const entry = {
      id: data.id,
      bracketNumber: data.bracketNumber,
      email: data.email,
      timestamp: Date.now(),
      key: `${data.bracketNumber}|${data.email}`
    };
    this.commentedHistory.unshift(entry);
    if (this.commentedHistory.length > this.maxHistorySize) {
      this.commentedHistory = this.commentedHistory.slice(0, this.maxHistorySize);
    }
    this.saveHistory();
  }

  isAlreadyCommented(bracketNumber, email) {
    if (!bracketNumber || !email) return false;
    const key = `${bracketNumber}|${email}`;
    return this.commentedHistory.some(e => e.key === key);
  }

  clearMarks() {
    document.querySelectorAll('.message-finder-label').forEach(el => el.remove());
    document.querySelectorAll(this.messageSelector).forEach(el => el.style.border = '');
  }

  async commentLastMessage() {
    const blocks = document.querySelectorAll(this.messageSelector);
    if (!blocks.length) return;
    let maxId = -1, latest = null;
    blocks.forEach(b => {
      const id = DataExtractor.getMessageId(b);
      if (id > maxId) { maxId = id; latest = b; }
    });
    if (latest) await this.commentOnMessage(latest);
  }

  getStatus() {
    return {
      paused: this.paused,
      waitingForCooldown: this.waitingForCooldown,
      pendingMessageId: this.pendingMessage ? DataExtractor.getMessageId(this.pendingMessage) : null,
      queueLength: this.messageQueue.length,
      myCommentedCount: this.myCommentedIds.size,
      stats: this.stats,
      lastMessageId: this.lastMessageId,
      initialMaxId: this.initialMaxId,
      messageCounter: this.messageCounter,
      skipCounter: this.skipCounter
    };
  }

  // Добавляем методы для ручного управления
  forceSendStats() {
    console.log('📊 Принудительная отправка статистики');
    this.wsClient.sendStats();
  }
  
  checkWebSocket() {
    if (this.wsClient && this.wsClient.ws) {
      const state = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][this.wsClient.ws.readyState];
      console.log(`🔌 WebSocket статус: ${state} (${this.wsClient.ws.readyState})`);
      return this.wsClient.ws.readyState;
    }
    console.log('❌ WebSocket не инициализирован');
    return -1;
  }
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
window.messageFinder = null;

function init() {
  window.messageFinder = new MessageFinder();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
} else {
  setTimeout(init, 1000);
}

// ==================== СЛУШАЕМ СООБЩЕНИЯ ИЗ POPUP ====================
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_STATUS') {
    const mf = window.messageFinder;
    if (mf) sendResponse(mf.getStatus());
    else sendResponse({ error: 'not initialized' });
  }
});