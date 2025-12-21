/**
 * Telegram Logger - отправка логов в личку через бота
 * Включается через TELEGRAM_LOG_ENABLED=true в .env
 * TELEGRAM_LOG_CHAT_ID - ID чата куда отправлять логи
 */

const https = require('https');

class TelegramLogger {
    constructor() {
        this.enabled = process.env.TELEGRAM_LOG_ENABLED === 'true';
        this.botToken = process.env.BOT_TOKEN;
        this.chatId = process.env.TELEGRAM_LOG_CHAT_ID;
        
        if (this.enabled && (!this.botToken || !this.chatId)) {
            console.warn('⚠️ TelegramLogger: BOT_TOKEN или TELEGRAM_LOG_CHAT_ID не настроены');
            this.enabled = false;
        }
        
        if (this.enabled) {
            console.log('📱 TelegramLogger включён, отправляем логи в чат:', this.chatId);
        }
    }
    
    /**
     * Отправить сообщение в Telegram
     */
    async send(message, type = 'info') {
        if (!this.enabled) return;
        
        const emoji = {
            info: 'ℹ️',
            success: '✅',
            error: '❌',
            warning: '⚠️',
            debug: '🔍',
            score: '🎮',
        }[type] || '📝';
        
        const text = `${emoji} <b>${type.toUpperCase()}</b>\n\n<code>${this.escapeHtml(message)}</code>`;
        
        try {
            await this._sendTelegram(text);
        } catch (error) {
            // Не логируем ошибки отправки чтобы избежать рекурсии
            console.error('TelegramLogger error:', error.message);
        }
    }
    
    /**
     * Логировать сохранение результата игры
     */
    async logScore(data) {
        if (!this.enabled) return;
        
        const { telegramId, sessionId, score, targetsHit, maxCombo, userId, scoreId } = data;
        
        const text = `🎮 <b>НОВЫЙ РЕЗУЛЬТАТ</b>

👤 User: ${telegramId ? `TG#${telegramId}` : `Session`}
🆔 UserID: ${userId}
🏆 Score: <b>${score}</b>
🎯 Hits: ${targetsHit}
🔥 Combo: x${maxCombo}
📝 ScoreID: ${scoreId}`;
        
        try {
            await this._sendTelegram(text);
        } catch (error) {
            console.error('TelegramLogger score error:', error.message);
        }
    }
    
    /**
     * Логировать ошибку
     */
    async logError(context, error) {
        if (!this.enabled) return;
        
        const text = `❌ <b>ОШИБКА</b>

📍 Context: ${context}
💥 Error: <code>${this.escapeHtml(error.message || String(error))}</code>
📚 Stack: <code>${this.escapeHtml((error.stack || '').slice(0, 500))}</code>`;
        
        try {
            await this._sendTelegram(text);
        } catch (err) {
            console.error('TelegramLogger error log failed:', err.message);
        }
    }
    
    /**
     * Логировать запрос
     */
    async logRequest(method, path, body, status) {
        if (!this.enabled) return;
        
        // Только логируем POST запросы к scores
        if (method !== 'POST' || !path.includes('/scores')) return;
        
        const safeBody = { ...body };
        delete safeBody.initData; // Удаляем sensitive данные
        
        const emoji = status >= 400 ? '❌' : '✅';
        
        const text = `${emoji} <b>${method} ${path}</b> [${status}]

📦 Body:
<code>${this.escapeHtml(JSON.stringify(safeBody, null, 2).slice(0, 1000))}</code>`;
        
        try {
            await this._sendTelegram(text);
        } catch (error) {
            console.error('TelegramLogger request log failed:', error.message);
        }
    }
    
    /**
     * Отправить сообщение через Telegram Bot API
     */
    _sendTelegram(text) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify({
                chat_id: this.chatId,
                text: text,
                parse_mode: 'HTML',
            });
            
            const options = {
                hostname: 'api.telegram.org',
                port: 443,
                path: `/bot${this.botToken}/sendMessage`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                },
            };
            
            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        resolve(body);
                    } else {
                        reject(new Error(`Telegram API error: ${res.statusCode} ${body}`));
                    }
                });
            });
            
            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }
    
    /**
     * Экранировать HTML символы
     */
    escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
}

// Singleton instance
const telegramLogger = new TelegramLogger();

module.exports = telegramLogger;

