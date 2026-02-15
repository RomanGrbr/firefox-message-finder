console.log('🔥 Message Finder: расширение загружено!');

// ==================== КОНСТАНТЫ ====================
const DEBUG_MODE = true;

const DELAY_MIN = 2000;
const DELAY_MAX = 5000;

const SKIP_MIN = 4;
const SKIP_MAX = 6;

const COMMENT_COOLDOWN = 300000; // 5 минут в мс
const TARGET_AUTHOR = 'Роман Гербер';

const RENDER_DELAYS = {
  INIT: 1000,
  HOVER: 800,
  PANEL: 2000,
  INPUT: 500,
  SUBMIT: 1000
};

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
  constructor(targetAuthor, cooldown) {
    this.targetAuthor = targetAuthor;
    this.cooldown = cooldown;
  }

  // Базовая проверка: номер не 1/20 и нет комментариев
  basicValidation(number, hasComments) {
    if (number === null) return false;
    if (number === 1 || number === 20) return false;
    if (hasComments) return false;
    return true;
  }

  isTargetAuthor(element) {
    const author = DataExtractor.getMessageAuthor(element);
    return author === this.targetAuthor;
  }
}

// ==================== ЗАГЛУШКА ДЛЯ TELEGRAM ====================
class TelegramNotifier {
  constructor() {
    this.enabled = false;
    this.commandListeners = [];
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; }

  async sendMessage(text) {
    if (!this.enabled) return;
    console.log(`[TELEGRAM] ${text}`);
    // Здесь будет реальный API
  }

  onCommand(callback) {
    this.commandListeners.push(callback);
  }

  // Заглушка для получения команд (можно вызывать вручную из консоли)
  simulateCommand(cmd) {
    this.commandListeners.forEach(fn => fn(cmd));
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
    this.validator = new MessageValidator(TARGET_AUTHOR, COMMENT_COOLDOWN);
    this.telegram = new TelegramNotifier();

    // Для управления очередью и блокировкой
    this.busy = false;
    this.pendingMessage = null;        // сообщение, ожидающее таймера
    this.pendingTimeout = null;
    this.messageQueue = [];            // очередь сообщений, пришедших во время busy

    // Хранилище времени обнаружения сообщений (id -> timestamp)
    this.detectedTimes = new Map();

    this.loadHistory();
    this.initialize();
  }

  getRandomSkip() {
    return Math.floor(Math.random() * (SKIP_MAX - SKIP_MIN + 1)) + SKIP_MIN;
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
      if (!this.initializationComplete) return;
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

      // Сохраняем время обнаружения
      if (!this.detectedTimes.has(id)) {
        this.detectedTimes.set(id, Date.now());
      }

      // Если уже обрабатывали это сообщение (по id)
      if (id <= this.lastProcessedId) continue;
      this.lastProcessedId = id;
      this.lastMessageId = id;

      // Пропуск по счётчику
      this.messageCounter++;
      if (this.messageCounter % this.skipCounter === 0) {
        this.skipCounter = this.getRandomSkip();
        continue;
      }

      // Если заняты, кладём в очередь
      if (this.busy) {
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

    if (!this.validator.basicValidation(number, hasComments)) {
      await this.handleNonTargetMessage(element);
      return;
    }

    // Проверяем автора
    const isTarget = this.validator.isTargetAuthor(element);

    if (isTarget) {
      // Ставим в ожидание на 5 минут от времени обнаружения
      const detectedTime = this.detectedTimes.get(DataExtractor.getMessageId(element));
      const timePassed = Date.now() - detectedTime;
      const waitTime = Math.max(0, COMMENT_COOLDOWN - timePassed);

      if (waitTime > 0) {
        this.busy = true;
        this.pendingMessage = element;
        console.log(`⏳ Ожидание ${waitTime/1000}с перед комментированием (автор ${TARGET_AUTHOR})`);

        this.pendingTimeout = setTimeout(async () => {
          // По истечении таймера комментируем сообщение
          await this.commentOnMessage(this.pendingMessage);
          this.pendingMessage = null;
          this.pendingTimeout = null;
          this.busy = false;
          // Обрабатываем накопившуюся очередь
          await this.processQueue();
        }, waitTime);
      } else {
        // Уже прошло 5 минут (например, если сообщение долго висело до обнаружения)
        await this.commentOnMessage(element);
      }
    } else {
      // Автор не целевой – комментируем сразу
      await this.commentOnMessage(element);
    }
  }

  async handleNonTargetMessage(element) {
    const panel = await this.ui.openCommentPanel(element);
    if (!panel) return;

    const messagesInPanel = this.ui.getMessagesInPanel(panel);
    if (messagesInPanel.length > 1) {
      const last = this.ui.getLastMessageInPanel(panel);
      // Можно сохранить информацию о последнем комментаторе, если нужно
    }

    await this.ui.closePanel(panel);
  }

  async commentOnMessage(element) {
    const panel = await this.ui.openCommentPanel(element);
    if (!panel) return;

    const messagesInPanel = this.ui.getMessagesInPanel(panel);
    if (messagesInPanel.length > 1) {
      // Уже есть комментарии – не наши
      await this.ui.closePanel(panel);
      return;
    }

    const success = await this.ui.enterComment(panel, '+');
    if (success) {
      await this.ui.submitComment(panel);
      await this.telegram.sendMessage(`Прокомментировано сообщение ID ${DataExtractor.getMessageId(element)}`);
    }

    await this.ui.closePanel(panel);
  }

  async processQueue() {
    while (this.messageQueue.length > 0 && !this.busy) {
      const next = this.messageQueue.shift();
      await this.handleNewMessage(next);
    }
  }

  // ========== УПРАВЛЕНИЕ ПАУЗОЙ (ЗАГЛУШКИ ДЛЯ TELEGRAM) ==========
  pause() {
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
    this.busy = true;
    console.log('⏸️ Работа приостановлена');
  }

  resume() {
    this.busy = false;
    console.log('▶️ Работа возобновлена');
    this.processQueue();
  }

  // ========== ИСТОРИЯ ==========
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

  // ========== КОНСОЛЬНЫЕ КОМАНДЫ ==========
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
      busy: this.busy,
      queueLength: this.messageQueue.length,
      pendingMessageId: this.pendingMessage ? DataExtractor.getMessageId(this.pendingMessage) : null,
      lastMessageId: this.lastMessageId,
      initialMaxId: this.initialMaxId,
      messageCounter: this.messageCounter,
      skipCounter: this.skipCounter
    };
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

console.log('✅ Доступны команды: messageFinder.commentLastMessage(), messageFinder.getStatus(), messageFinder.pause(), messageFinder.resume()');