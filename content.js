// content.js
console.log('🔥 Message Finder: расширение загружено!');

// Режим отладки - установи true для тестирования без проверок
const DEBUG_MODE = true; // Меняй на false для реальной работы

class MessageFinder {
  constructor() {
    this.lastMessageId = 0;
    this.initialMaxId = 0;
    this.foundMessages = new Map();
    this.messageSelector = 'div[data-message-id]';
    this.initializationComplete = false;
    
    this.commentedHistory = [];
    this.maxHistorySize = 10;
    
    console.log(`🔍 Message Finder инициализирован ${DEBUG_MODE ? '(РЕЖИМ ОТЛАДКИ)' : ''}`);
    
    // Загружаем историю
    this.loadHistory();
    
    // Запускаем поиск максимального ID
    this.initialize();
  }
  
  async initialize() {
    // Ждем немного, чтобы DOM точно загрузился
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Находим максимальный ID
    this.findMaxMessageId();
  }
  
  findMaxMessageId() {
    console.log('🔎 Ищем максимальный ID среди существующих сообщений...');
    
    const messageBlocks = document.querySelectorAll(this.messageSelector);
    console.log(`📊 Найдено элементов с data-message-id: ${messageBlocks.length}`);
    
    if (messageBlocks.length > 0) {
      // Ищем максимум простым перебором
      let maxId = -1;
      let latestMessage = null;
      
      messageBlocks.forEach(block => {
        const id = parseInt(block.getAttribute('data-message-id'));
        if (id > maxId) {
          maxId = id;
          latestMessage = block;
        }
      });
      
      if (latestMessage) {
        this.initialMaxId = maxId;
        this.lastMessageId = maxId;
        
        console.log(`🏆 МАКСИМАЛЬНЫЙ ID: ${maxId}`);
        console.log(`📍 Отправная точка: сообщения с ID > ${maxId} будут считаться новыми`);
        
        // Подсвечиваем самое свежее
        this.markAsLatest(latestMessage);
        
        // Запускаем наблюдение
        this.initializationComplete = true;
        this.observeNewMessages();
      }
    } else {
      console.log('❌ Сообщения не найдены, начинаем наблюдение с 0');
      this.initialMaxId = 0;
      this.initializationComplete = true;
      this.observeNewMessages();
    }
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
    const observer = new MutationObserver((mutations) => {
      if (!this.initializationComplete) return;
      
      let newMessages = [];
      
      mutations.forEach(mutation => {
        if (mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.matches && node.matches(this.messageSelector)) {
                newMessages.push(node);
              }
              
              const innerMessages = node.querySelectorAll 
                ? node.querySelectorAll(this.messageSelector) 
                : [];
              if (innerMessages.length > 0) {
                newMessages.push(...innerMessages);
              }
            }
          });
        }
      });
      
      if (newMessages.length > 0) {
        this.processNewMessages(newMessages);
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    console.log('👀 Наблюдаю за новыми сообщениями...');
  }
  
  extractEmail(text) {
    const emailMatch = text.match(/\(([^)]+@[^)]+)\)/);
    return emailMatch ? emailMatch[1] : null;
  }
  
  async clickCommentButton(messageElement) {
    console.log('🖱️ Пытаемся нажать кнопку комментария...');
    
    try {
      // 1. Наводим мышь на сообщение, чтобы появились кнопки
      messageElement.dispatchEvent(new MouseEvent('mouseenter', {
        bubbles: true,
        cancelable: true,
        view: window
      }));
      
      // 2. Ждем появления кнопок
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // 3. Ищем кнопку комментария
      let commentButton = null;
      
      // Способ 1: По атрибуту aria-label
      commentButton = messageElement.querySelector('button[aria-label="Discuss in&nbsp;thread"]');
      
      // Способ 2: По SVG внутри
      if (!commentButton) {
        commentButton = messageElement.querySelector('button svg[stroke="currentColor"]')?.closest('button');
      }
      
      // Способ 3: По классу и позиции
      if (!commentButton) {
        const buttons = messageElement.querySelectorAll('.group-hover\\/message\\:flex\\! button');
        if (buttons.length >= 2) {
          commentButton = buttons[1];
        }
      }
      
      // Способ 4: По контейнеру
      if (!commentButton) {
        const buttonContainer = messageElement.querySelector('.group-hover\\/message\\:flex\\!');
        if (buttonContainer) {
          const buttons = buttonContainer.querySelectorAll('button');
          if (buttons.length >= 2) {
            commentButton = buttons[1];
          }
        }
      }
      
      if (commentButton) {
        console.log('✅ Кнопка найдена, кликаем');
        
        await new Promise(resolve => setTimeout(resolve, 100));
        commentButton.click();
        
        console.log('✅ Клик выполнен');
        
        // Ждем появления поля для комментария
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const textarea = document.querySelector('textarea[placeholder*="комментари"], textarea[placeholder*="Comment"]');
        if (textarea) {
          console.log('📝 Поле для комментария появилось');
        }
        
        return true;
      } else {
        console.log('❌ Кнопка не найдена');
        return false;
      }
      
    } catch (error) {
      console.error('❌ Ошибка при клике:', error);
      return false;
    }
  }
  
  processNewMessages(messages) {
    messages.forEach(messageElement => {
      const messageId = parseInt(messageElement.getAttribute('data-message-id'));
      
      // Проверяем, что ID больше начального максимального
      if (messageId > this.initialMaxId) {
        console.log(`✨ НОВОЕ СООБЩЕНИЕ ID: ${messageId} (новое, т.к. > ${this.initialMaxId})`);
        
        this.lastMessageId = messageId;
        this.foundMessages.set(messageId, messageElement);
        
        // В РЕЖИМЕ ОТЛАДКИ - комментируем ВСЕ новые сообщения
        if (DEBUG_MODE) {
          console.log(`   🧪 РЕЖИМ ОТЛАДКИ: комментируем сообщение ${messageId}`);
          
          // Просто вызываем клик без проверок
          this.clickCommentButton(messageElement);
          
          // Не добавляем в историю в режиме отладки
          console.log('   🤖 ТЕСТОВЫЙ КЛИК!');
          return; // Выходим, не выполняем остальные проверки
        }
        
        // НОРМАЛЬНЫЙ РЕЖИМ - со всеми проверками
        const analysis = this.analyzeMessage(messageElement);
        
        if (analysis.bracketNumber && analysis.email) {
          analysis.wasCommented = this.isAlreadyCommented(analysis.bracketNumber, analysis.email);
        }
        
        const needsComment = analysis.bracketNumber !== null && 
                            analysis.bracketNumber !== 1 && 
                            analysis.bracketNumber !== 20 && 
                            !analysis.hasComments &&
                            !analysis.wasCommented;
        
        if (needsComment) {
          console.log(`   🎯 ЦЕЛЬ: [${analysis.bracketNumber}] ${analysis.email}`);
          console.log(`   Текст: ${analysis.text.substring(0, 100)}...`);
          
          this.clickCommentButton(messageElement);
          
          this.addToHistory({
            id: messageId,
            bracketNumber: analysis.bracketNumber,
            email: analysis.email,
            text: analysis.text
          });
          
          console.log('   🤖 КОММЕНТИРУЕМ!');
        } else {
          let reason = '';
          if (!analysis.bracketNumber) reason = 'нет числа';
          else if (analysis.bracketNumber === 1 || analysis.bracketNumber === 20) reason = `число ${analysis.bracketNumber}`;
          else if (analysis.hasComments) reason = 'уже есть комментарии';
          else if (analysis.wasCommented) reason = 'было в истории';
          console.log(`   ⏭️ Пропущено: ${reason}`);
        }
      } else {
        console.log(`   ⏭️ Игнорируем ID: ${messageId} (старое, <= ${this.initialMaxId})`);
      }
    });
  }
  
  analyzeMessage(element) {
    const textElement = element.querySelector('.markup p');
    const text = textElement ? textElement.textContent.trim() : '';
    
    const bracketMatch = text.match(/\[(\d+)\]/);
    const bracketNumber = bracketMatch ? parseInt(bracketMatch[1]) : null;
    
    const email = this.extractEmail(text);
    
    const commentBlock = element.querySelector('.flex.flex-wrap.gap-1 button');
    const hasComments = commentBlock !== null;
    
    return {
      text: text,
      bracketNumber: bracketNumber,
      email: email,
      hasComments: hasComments,
      wasCommented: false
    };
  }
  
  loadHistory() {
    try {
      const saved = localStorage.getItem('messageFinderHistory');
      if (saved) {
        this.commentedHistory = JSON.parse(saved);
        console.log('📚 Загружена история комментариев:', this.commentedHistory.length, 'записей');
      }
    } catch (e) {
      console.log('⚠️ Не удалось загрузить историю');
    }
  }
  
  saveHistory() {
    try {
      localStorage.setItem('messageFinderHistory', JSON.stringify(this.commentedHistory));
    } catch (e) {
      console.log('⚠️ Не удалось сохранить историю');
    }
  }
  
  addToHistory(messageData) {
    const historyEntry = {
      id: messageData.id,
      bracketNumber: messageData.bracketNumber,
      email: messageData.email,
      timestamp: Date.now(),
      key: `${messageData.bracketNumber}|${messageData.email}`
    };
    
    this.commentedHistory.unshift(historyEntry);
    
    if (this.commentedHistory.length > this.maxHistorySize) {
      this.commentedHistory = this.commentedHistory.slice(0, this.maxHistorySize);
    }
    
    this.saveHistory();
    console.log(`   ✅ Добавлено в историю: [${messageData.bracketNumber}] (${messageData.email})`);
  }
  
  isAlreadyCommented(bracketNumber, email) {
    if (!bracketNumber || !email) return false;
    
    const key = `${bracketNumber}|${email}`;
    return this.commentedHistory.some(entry => entry.key === key);
  }

  clearMarks() {
    document.querySelectorAll('.message-finder-label').forEach(el => el.remove());
    document.querySelectorAll(this.messageSelector).forEach(el => {
      el.style.border = '';
    });
  }
}

// Запускаем
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.messageFinder = new MessageFinder();
  });
} else {
  setTimeout(() => {
    window.messageFinder = new MessageFinder();
  }, 500);
}

// Добавляем команду для переключения режима из консоли
window.toggleDebugMode = function() {
  DEBUG_MODE = !DEBUG_MODE;
  console.log(`🔄 Режим отладки ${DEBUG_MODE ? 'ВКЛЮЧЕН' : 'ВЫКЛЮЧЕН'}`);
};