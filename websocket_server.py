import asyncio
import json
import logging
import os
import sys
import threading
from datetime import datetime

import telebot
import websockets
from dotenv import load_dotenv
from telebot.types import InlineKeyboardButton, InlineKeyboardMarkup

load_dotenv()


# ==================== НАСТРОЙКИ ====================
TELEGRAM_TOKEN = os.getenv('BOT_TOKEN')  # Замените на токен вашего бота
YOUR_CHAT_ID = int(os.getenv('CHAT_ID'))  # Замените на ваш chat_id (можно узнать у @userinfobot)
WEBSOCKET_PORT = 8765
WEBSOCKET_HOST = "localhost"


# Настройка логирования
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO,
    stream=sys.stdout
)
logger = logging.getLogger(__name__)

# ==================== ХРАНИЛИЩЕ СОСТОЯНИЯ ====================
class State:
    def __init__(self):
        self.connected_clients = set()
        self.stats = {
            "commented": 0,
            "skipped": 0,
            "ignored": 0,
            "queueLength": 0,
            "waitingForCooldown": False,
            "lastMessageId": 0,
            "messageCounter": 0
        }
        self.settings = {
            "logLevel": 1,
            "commentProbability": 70,
            "autoPauseAfterComment": False
        }
        self.last_comment = None
        self.extension_paused = False  # Текущий статус паузы расширения

state = State()

# ==================== ИНИЦИАЛИЗАЦИЯ БОТА ====================
bot = telebot.TeleBot(TELEGRAM_TOKEN, parse_mode='HTML')

# ==================== ПОСТОЯННАЯ КЛАВИАТУРА ====================
def get_main_keyboard():
    """Возвращает постоянную клавиатуру с актуальным статусом"""
    keyboard = InlineKeyboardMarkup(row_width=2)
    
    # Статус кнопки паузы зависит от текущего состояния
    pause_button = InlineKeyboardButton(
        "⏸️ Пауза" if not state.extension_paused else "▶️ Возобновить",
        callback_data="toggle_pause"
    )
    
    keyboard.add(
        InlineKeyboardButton("📊 Статистика", callback_data="stats"),
        pause_button,
        InlineKeyboardButton("🔄 Статус", callback_data="status"),
        InlineKeyboardButton("⚙️ Настройки", callback_data="settings")
    )
    return keyboard

def update_main_keyboard(chat_id, message_id=None):
    """Обновляет клавиатуру во всех сообщениях или в конкретном"""
    try:
        if message_id:
            bot.edit_message_reply_markup(
                chat_id,
                message_id,
                reply_markup=get_main_keyboard()
            )
    except Exception as e:
        logger.error(f"Ошибка обновления клавиатуры: {e}")

# ==================== ФОРМАТИРОВАНИЕ СООБЩЕНИЙ ====================
def format_comment(data):
    """Форматирует данные комментария для отправки в Telegram"""
    text = data.get('text', '')
    link = data.get('link', '')
    number = data.get('number', '?')
    author = data.get('author', 'Неизвестно')
    email = data.get('email', '')
    timestamp = datetime.fromtimestamp(data.get('timestamp', 0) / 1000).strftime('%Y-%m-%d %H:%M:%S')
    
    task_id = link.split('/')[-1] if link else 'Неизвестно'
    
    message = f"✅ <b>Прокомментировано сообщение</b>\n\n"
    message += f"<b>Задача:</b> <a href='{link}'>{task_id}</a>\n"
    message += f"<b>Номер в скобках:</b> [{number}]\n"
    message += f"<b>Автор сообщения:</b> {author}\n"
    message += f"<b>Email:</b> {email}\n"
    message += f"<b>Время:</b> {timestamp}\n\n"
    message += f"<b>Полный текст:</b>\n<code>{text}</code>"
    
    return message

def format_stats():
    """Форматирует статистику для отправки в Telegram"""
    stats = state.stats
    settings = state.settings
    
    message = f"📊 <b>Статистика работы</b>\n\n"
    message += f"<b>Статус:</b> {'⏸️ На паузе' if state.extension_paused else '▶️ Активно'}\n"
    message += f"<b>Прокомментировано:</b> {stats['commented']}\n"
    message += f"<b>Пропущено:</b> {stats['skipped']}\n"
    message += f"<b>Игнорировано:</b> {stats['ignored']}\n"
    message += f"<b>В очереди:</b> {stats['queueLength']}\n"
    message += f"<b>Ожидание 5 мин:</b> {'да' if stats['waitingForCooldown'] else 'нет'}\n"
    message += f"<b>Всего сообщений обработано:</b> {stats['messageCounter']}\n\n"
    
    message += f"⚙️ <b>Текущие настройки</b>\n"
    message += f"<b>Уровень логов:</b> {settings['logLevel']} (0-выкл, 1-осн, 2-отл)\n"
    message += f"<b>Вероятность комментирования:</b> {settings['commentProbability']}%\n"
    message += f"<b>Автопауза после комментария:</b> {'вкл' if settings['autoPauseAfterComment'] else 'выкл'}\n"
    
    return message

def format_status():
    """Форматирует статус работы"""
    status = f"🔄 <b>Статус работы</b>\n\n"
    status += f"<b>Расширение:</b> {'⏸️ На паузе' if state.extension_paused else '▶️ Активно'}\n"
    status += f"<b>Подключение:</b> {'✅ есть' if state.connected_clients else '❌ нет'}\n"
    if state.connected_clients:
        status += f"<b>Клиентов подключено:</b> {len(state.connected_clients)}\n"
    
    status += f"<b>Ожидание 5 мин:</b> {'да' if state.stats['waitingForCooldown'] else 'нет'}\n"
    status += f"<b>В очереди сообщений:</b> {state.stats['queueLength']}\n"
    
    if state.last_comment:
        last_time = datetime.fromtimestamp(state.last_comment['timestamp'] / 1000).strftime('%Y-%m-%d %H:%M:%S')
        status += f"\n<b>Последний комментарий:</b> {last_time}\n"
        status += f"<b>Задача:</b> {state.last_comment.get('link', '')}"
    
    return status

# ==================== ФУНКЦИИ ДЛЯ РАБОТЫ С WEBSOCKET ====================
async def send_command_to_clients(command):
    """Отправляет команду всем подключенным клиентам"""
    if not state.connected_clients:
        logger.warning("⚠️ Нет подключенных клиентов для отправки команды")
        return
    
    disconnected = set()
    for client in state.connected_clients:
        try:
            await client.send(json.dumps(command))
            logger.info(f"📤 Отправлена команда клиенту: {command['type']}")
        except Exception as e:
            logger.error(f"❌ Ошибка отправки команды: {e}")
            disconnected.add(client)
    
    state.connected_clients -= disconnected

def send_command_sync(command):
    """Синхронная обертка для отправки команд (для вызова из потоков)"""
    if not state.connected_clients:
        logger.warning("⚠️ Нет подключенных клиентов для отправки команды")
        return False
    
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(send_command_to_clients(command))
        return True
    except Exception as e:
        logger.error(f"❌ Ошибка отправки команды: {e}")
        return False
    finally:
        loop.close()

# ==================== ОБРАБОТЧИКИ КОМАНД TELEGRAM ====================
@bot.message_handler(commands=['start'])
def start_command(message):
    if message.chat.id != YOUR_CHAT_ID:
        bot.reply_to(message, "Извините, этот бот только для личного использования.")
        return
    
    msg = bot.send_message(
        message.chat.id,
        "👋 <b>Message Finder Bot</b>\n\n"
        "Я бот для управления расширением Message Finder.\n"
        "Постоянная клавиатура всегда под сообщениями.\n\n"
        "Команды:\n"
        "/stats - статистика\n"
        "/pause - пауза\n"
        "/resume - возобновить\n"
        "/status - статус\n"
        "/log [0|1|2] - уровень логов\n"
        "/prob [0-100] - вероятность\n"
        "/autopause [on|off] - автопауза\n"
        "/help - помощь",
        reply_markup=get_main_keyboard()
    )
    
    # Сохраняем ID сообщения для будущих обновлений клавиатуры
    state.main_message_id = msg.message_id

@bot.message_handler(commands=['stats'])
def stats_command(message):
    if message.chat.id != YOUR_CHAT_ID:
        return
    bot.send_message(message.chat.id, format_stats(), reply_markup=get_main_keyboard())

@bot.message_handler(commands=['pause'])
def pause_command(message):
    if message.chat.id != YOUR_CHAT_ID:
        return
    
    logger.info("⏸️ Получена команда паузы")
    if send_command_sync({"type": "pause"}):
        state.extension_paused = True
        bot.send_message(message.chat.id, "⏸️ Расширение поставлено на паузу.", reply_markup=get_main_keyboard())
        # Обновляем клавиатуру в главном сообщении
        if hasattr(state, 'main_message_id'):
            update_main_keyboard(message.chat.id, state.main_message_id)
    else:
        bot.send_message(message.chat.id, "❌ Нет подключенного расширения.", reply_markup=get_main_keyboard())

@bot.message_handler(commands=['resume'])
def resume_command(message):
    if message.chat.id != YOUR_CHAT_ID:
        return
    
    logger.info("▶️ Получена команда возобновления")
    if send_command_sync({"type": "resume"}):
        state.extension_paused = False
        bot.send_message(message.chat.id, "▶️ Работа расширения возобновлена.", reply_markup=get_main_keyboard())
        # Обновляем клавиатуру в главном сообщении
        if hasattr(state, 'main_message_id'):
            update_main_keyboard(message.chat.id, state.main_message_id)
    else:
        bot.send_message(message.chat.id, "❌ Нет подключенного расширения.", reply_markup=get_main_keyboard())

@bot.message_handler(commands=['status'])
def status_command(message):
    if message.chat.id != YOUR_CHAT_ID:
        return
    bot.send_message(message.chat.id, format_status(), reply_markup=get_main_keyboard())

@bot.message_handler(commands=['log'])
def log_command(message):
    if message.chat.id != YOUR_CHAT_ID:
        return
    
    try:
        args = message.text.split()
        if len(args) != 2:
            bot.reply_to(message, "Использование: /log [0|1|2]", reply_markup=get_main_keyboard())
            return
        
        level = int(args[1])
        if level in [0, 1, 2]:
            state.settings['logLevel'] = level
            send_command_sync({"type": "setLogLevel", "level": level})
            bot.reply_to(message, f"✅ Уровень логирования установлен: {level}", reply_markup=get_main_keyboard())
        else:
            bot.reply_to(message, "Использование: /log [0|1|2]", reply_markup=get_main_keyboard())
    except ValueError:
        bot.reply_to(message, "Использование: /log [0|1|2]", reply_markup=get_main_keyboard())

@bot.message_handler(commands=['prob'])
def prob_command(message):
    if message.chat.id != YOUR_CHAT_ID:
        return
    
    try:
        args = message.text.split()
        if len(args) != 2:
            bot.reply_to(message, "Использование: /prob [0-100]", reply_markup=get_main_keyboard())
            return
        
        prob = int(args[1])
        if 0 <= prob <= 100:
            state.settings['commentProbability'] = prob
            send_command_sync({"type": "setProbability", "value": prob})
            bot.reply_to(message, f"✅ Вероятность комментирования установлена: {prob}%", reply_markup=get_main_keyboard())
        else:
            bot.reply_to(message, "Использование: /prob [0-100]", reply_markup=get_main_keyboard())
    except ValueError:
        bot.reply_to(message, "Использование: /prob [0-100]", reply_markup=get_main_keyboard())

@bot.message_handler(commands=['autopause'])
def autopause_command(message):
    if message.chat.id != YOUR_CHAT_ID:
        return
    
    try:
        args = message.text.split()
        if len(args) != 2:
            bot.reply_to(message, "Использование: /autopause [on|off]", reply_markup=get_main_keyboard())
            return
        
        arg = args[1].lower()
        if arg in ['on', 'off']:
            value = (arg == 'on')
            state.settings['autoPauseAfterComment'] = value
            send_command_sync({"type": "setAutoPause", "value": value})
            bot.reply_to(message, f"✅ Автопауза после комментария: {'вкл' if value else 'выкл'}", reply_markup=get_main_keyboard())
        else:
            bot.reply_to(message, "Использование: /autopause [on|off]", reply_markup=get_main_keyboard())
    except:
        bot.reply_to(message, "Использование: /autopause [on|off]", reply_markup=get_main_keyboard())

@bot.message_handler(commands=['help'])
def help_command(message):
    if message.chat.id != YOUR_CHAT_ID:
        return
    
    help_text = (
        "📚 <b>Доступные команды:</b>\n\n"
        "/start - начать работу\n"
        "/stats - статистика\n"
        "/pause - поставить на паузу\n"
        "/resume - возобновить работу\n"
        "/status - статус работы\n"
        "/log [0|1|2] - уровень логов\n"
        "/prob [0-100] - вероятность комментирования\n"
        "/autopause [on|off] - автопауза после комментария\n"
        "/help - эта справка\n\n"
        "Постоянная клавиатура всегда под сообщениями."
    )
    bot.send_message(message.chat.id, help_text, reply_markup=get_main_keyboard())

# ==================== ОБРАБОТЧИКИ INLINE-КНОПОК ====================
@bot.callback_query_handler(func=lambda call: True)
def callback_handler(call):
    if call.message.chat.id != YOUR_CHAT_ID:
        return
    
    if call.data == "stats":
        bot.edit_message_text(
            format_stats(),
            call.message.chat.id,
            call.message.message_id,
            reply_markup=get_main_keyboard()
        )
    
    elif call.data == "toggle_pause":
        if state.extension_paused:
            # Сейчас на паузе -> возобновляем
            if send_command_sync({"type": "resume"}):
                state.extension_paused = False
                bot.answer_callback_query(call.id, "▶️ Работа возобновлена")
                bot.edit_message_text(
                    "▶️ Работа расширения возобновлена.",
                    call.message.chat.id,
                    call.message.message_id,
                    reply_markup=get_main_keyboard()
                )
                # Обновляем главную клавиатуру
                if hasattr(state, 'main_message_id'):
                    update_main_keyboard(call.message.chat.id, state.main_message_id)
            else:
                bot.answer_callback_query(call.id, "❌ Нет подключения", show_alert=True)
        else:
            # Сейчас активно -> ставим на паузу
            if send_command_sync({"type": "pause"}):
                state.extension_paused = True
                bot.answer_callback_query(call.id, "⏸️ Пауза")
                bot.edit_message_text(
                    "⏸️ Расширение поставлено на паузу.",
                    call.message.chat.id,
                    call.message.message_id,
                    reply_markup=get_main_keyboard()
                )
                # Обновляем главную клавиатуру
                if hasattr(state, 'main_message_id'):
                    update_main_keyboard(call.message.chat.id, state.main_message_id)
            else:
                bot.answer_callback_query(call.id, "❌ Нет подключения", show_alert=True)
    
    elif call.data == "status":
        bot.edit_message_text(
            format_status(),
            call.message.chat.id,
            call.message.message_id,
            reply_markup=get_main_keyboard()
        )
    
    elif call.data == "settings":
        keyboard = InlineKeyboardMarkup(row_width=1)
        keyboard.add(
            InlineKeyboardButton(f"📊 Уровень логов: {state.settings['logLevel']}", callback_data="cycle_log"),
            InlineKeyboardButton(f"🎲 Вероятность: {state.settings['commentProbability']}%", callback_data="cycle_prob"),
            InlineKeyboardButton(f"⏸️ Автопауза: {'вкл' if state.settings['autoPauseAfterComment'] else 'выкл'}", callback_data="toggle_autopause"),
            InlineKeyboardButton("◀️ Назад", callback_data="back_to_start")
        )
        bot.edit_message_text(
            "⚙️ <b>Настройки</b>\n\n"
            "Используйте кнопки для изменения.\n"
            "Для точной настройки используйте команды:\n"
            "/log, /prob, /autopause",
            call.message.chat.id,
            call.message.message_id,
            reply_markup=keyboard
        )
    
    elif call.data == "cycle_log":
        new_level = (state.settings['logLevel'] + 1) % 3
        state.settings['logLevel'] = new_level
        send_command_sync({"type": "setLogLevel", "level": new_level})
        
        keyboard = InlineKeyboardMarkup(row_width=1)
        keyboard.add(
            InlineKeyboardButton(f"📊 Уровень логов: {new_level}", callback_data="cycle_log"),
            InlineKeyboardButton(f"🎲 Вероятность: {state.settings['commentProbability']}%", callback_data="cycle_prob"),
            InlineKeyboardButton(f"⏸️ Автопауза: {'вкл' if state.settings['autoPauseAfterComment'] else 'выкл'}", callback_data="toggle_autopause"),
            InlineKeyboardButton("◀️ Назад", callback_data="back_to_start")
        )
        bot.edit_message_reply_markup(
            call.message.chat.id,
            call.message.message_id,
            reply_markup=keyboard
        )
        bot.answer_callback_query(call.id, f"Уровень логов: {new_level}")
    
    elif call.data == "cycle_prob":
        new_prob = (state.settings['commentProbability'] + 10) % 110
        if new_prob > 100:
            new_prob = 0
        state.settings['commentProbability'] = new_prob
        send_command_sync({"type": "setProbability", "value": new_prob})
        
        keyboard = InlineKeyboardMarkup(row_width=1)
        keyboard.add(
            InlineKeyboardButton(f"📊 Уровень логов: {state.settings['logLevel']}", callback_data="cycle_log"),
            InlineKeyboardButton(f"🎲 Вероятность: {new_prob}%", callback_data="cycle_prob"),
            InlineKeyboardButton(f"⏸️ Автопауза: {'вкл' if state.settings['autoPauseAfterComment'] else 'выкл'}", callback_data="toggle_autopause"),
            InlineKeyboardButton("◀️ Назад", callback_data="back_to_start")
        )
        bot.edit_message_reply_markup(
            call.message.chat.id,
            call.message.message_id,
            reply_markup=keyboard
        )
        bot.answer_callback_query(call.id, f"Вероятность: {new_prob}%")
    
    elif call.data == "toggle_autopause":
        new_value = not state.settings['autoPauseAfterComment']
        state.settings['autoPauseAfterComment'] = new_value
        send_command_sync({"type": "setAutoPause", "value": new_value})
        
        keyboard = InlineKeyboardMarkup(row_width=1)
        keyboard.add(
            InlineKeyboardButton(f"📊 Уровень логов: {state.settings['logLevel']}", callback_data="cycle_log"),
            InlineKeyboardButton(f"🎲 Вероятность: {state.settings['commentProbability']}%", callback_data="cycle_prob"),
            InlineKeyboardButton(f"⏸️ Автопауза: {'вкл' if new_value else 'выкл'}", callback_data="toggle_autopause"),
            InlineKeyboardButton("◀️ Назад", callback_data="back_to_start")
        )
        bot.edit_message_reply_markup(
            call.message.chat.id,
            call.message.message_id,
            reply_markup=keyboard
        )
        bot.answer_callback_query(call.id, f"Автопауза: {'вкл' if new_value else 'выкл'}")
    
    elif call.data == "back_to_start":
        bot.edit_message_text(
            "👋 <b>Message Finder Bot</b>\n\n"
            "Выберите действие:",
            call.message.chat.id,
            call.message.message_id,
            reply_markup=get_main_keyboard()
        )

# ==================== WEBSOCKET-СЕРВЕР ====================
async def handle_websocket(websocket):
    """Обработчик WebSocket-соединения от расширения"""
    client_id = id(websocket)
    logger.info(f"🔌 Новое WebSocket-соединение: {client_id}")
    
    try:
        await websocket.send(json.dumps({"type": "connected", "message": "Соединение установлено"}))
    except:
        pass
    
    state.connected_clients.add(websocket)
    logger.info(f"👥 Всего клиентов: {len(state.connected_clients)}")
    
    bot.send_message(
        YOUR_CHAT_ID,
        f"✅ Расширение подключилось к серверу!\n"
        f"Клиентов: {len(state.connected_clients)}",
        reply_markup=get_main_keyboard()
    )
    
    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                
                if data['type'] == 'comment':
                    state.last_comment = data['data']
                    bot.send_message(
                        YOUR_CHAT_ID,
                        format_comment(data['data']),
                        reply_markup=get_main_keyboard()
                    )
                
                elif data['type'] == 'stats':
                    state.stats.update(data['data'])
                    logger.info(f"📊 Статистика обновлена: commented={state.stats['commented']}")
                
                elif data['type'] == 'status_update':
                    # Обновление статуса паузы от расширения
                    if 'paused' in data:
                        state.extension_paused = data['paused']
                        logger.info(f"🔄 Статус паузы обновлен: {'пауза' if state.extension_paused else 'активно'}")
                        
                        # Отправляем статус в Telegram
                        bot.send_message(
                            YOUR_CHAT_ID,
                            f"🔄 Статус расширения изменен: {'⏸️ На паузе' if state.extension_paused else '▶️ Активно'}",
                            reply_markup=get_main_keyboard()
                        )
                        
                        # Обновляем клавиатуру в главном сообщении
                        if hasattr(state, 'main_message_id'):
                            update_main_keyboard(YOUR_CHAT_ID, state.main_message_id)
                
                elif data['type'] == 'log':
                    level = data.get('level', 1)
                    if level >= state.settings['logLevel']:
                        logger.info(f"📝 [ЛОГ {level}] {data['message']}")
                        
                        if level >= 2:
                            bot.send_message(
                                YOUR_CHAT_ID,
                                f"🔍 <b>Отладка:</b>\n<code>{data['message']}</code>",
                                reply_markup=get_main_keyboard()
                            )
                            
            except json.JSONDecodeError:
                logger.error(f"❌ Ошибка парсинга JSON")
            except KeyError as e:
                logger.error(f"❌ Отсутствует ключ в сообщении: {e}")
    
    except websockets.exceptions.ConnectionClosed as e:
        logger.info(f"🔌 Соединение закрыто: {client_id}")
    except Exception as e:
        logger.error(f"❌ Ошибка в WebSocket: {e}")
    finally:
        state.connected_clients.remove(websocket)
        logger.info(f"👥 Клиент отключен. Осталось: {len(state.connected_clients)}")
        
        bot.send_message(
            YOUR_CHAT_ID,
            f"❌ Расширение отключилось от сервера.\n"
            f"Осталось клиентов: {len(state.connected_clients)}",
            reply_markup=get_main_keyboard()
        )

async def start_websocket_server():
    """Запуск WebSocket-сервера"""
    server = await websockets.serve(
        handle_websocket,
        WEBSOCKET_HOST,
        WEBSOCKET_PORT
    )
    logger.info(f"WebSocket-сервер запущен на {WEBSOCKET_HOST}:{WEBSOCKET_PORT}")
    return server

# ==================== ЗАПУСК БОТА В ОТДЕЛЬНОМ ПОТОКЕ ====================
def run_bot():
    """Запускает Telegram бота в отдельном потоке"""
    logger.info("Telegram бот запущен")
    bot.infinity_polling()

# ==================== ОСНОВНАЯ ФУНКЦИЯ ====================
async def main():
    """Главная функция, запускающая WebSocket-сервер"""
    # Запускаем бота в отдельном потоке
    bot_thread = threading.Thread(target=run_bot, daemon=True)
    bot_thread.start()
    
    # Запускаем WebSocket-сервер
    ws_server = await start_websocket_server()
    
    # Держим сервер запущенным
    await ws_server.wait_closed()

if __name__ == "__main__":
    print(f"🚀 Запуск websocket_server.py с портом {WEBSOCKET_PORT}")
    asyncio.run(main())
