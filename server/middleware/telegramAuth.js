/**
 * Telegram Web App аутентификация
 * Верификация initData и извлечение данных пользователя
 */

const crypto = require('crypto');
const { HTTP } = require('../config/constants');

/**
 * Верификация данных от Telegram Web App
 * @param {string} initData - Строка initData от Telegram
 * @param {string} botToken - Токен бота от @BotFather
 * @returns {boolean} - Валидны ли данные
 */
function verifyTelegramWebAppData(initData, botToken) {
    if (!initData || !botToken) {
        return false;
    }
    
    try {
        // 1. Парсим initData (URL-encoded строка)
        const urlParams = new URLSearchParams(initData);
        const hash = urlParams.get('hash');
        
        if (!hash) {
            return false;
        }
        
        // Удаляем hash из параметров для проверки
        urlParams.delete('hash');
        
        // 2. Сортируем параметры и создаём строку для проверки
        const dataCheckString = Array.from(urlParams.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');
        
        // 3. Создаём секретный ключ из токена бота
        const secretKey = crypto
            .createHmac('sha256', 'WebAppData')
            .update(botToken)
            .digest();
        
        // 4. Вычисляем HMAC-SHA256
        const calculatedHash = crypto
            .createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');
        
        // 5. Сравниваем хеши (timing-safe comparison)
        return crypto.timingSafeEqual(
            Buffer.from(hash, 'hex'),
            Buffer.from(calculatedHash, 'hex')
        );
    } catch (error) {
        console.error('❌ Ошибка верификации Telegram данных:', error.message);
        return false;
    }
}

/**
 * Извлечение данных пользователя из initData
 * @param {string} initData - Строка initData от Telegram
 * @returns {object|null} - Данные пользователя
 */
function extractTelegramUser(initData) {
    if (!initData) return null;
    
    try {
        const urlParams = new URLSearchParams(initData);
        const userJson = urlParams.get('user');
        
        if (!userJson) return null;
        
        const user = JSON.parse(userJson);
        
        return {
            telegramId: user.id,
            username: user.username || null,
            firstName: user.first_name || '',
            lastName: user.last_name || '',
            languageCode: user.language_code || 'en',
            isPremium: user.is_premium || false,
        };
    } catch (error) {
        console.error('❌ Ошибка извлечения данных пользователя:', error.message);
        return null;
    }
}

/**
 * Middleware для аутентификации через Telegram
 */
function telegramAuthMiddleware(req, res, next) {
    const { initData, sessionId } = req.body;
    const botToken = process.env.BOT_TOKEN;
    const isDev = process.env.NODE_ENV === 'development';
    const skipVerify = process.env.SKIP_TELEGRAM_VERIFY === 'true';
    
    // Режим 1: Telegram Web App аутентификация
    if (initData) {
        // В production обязательно проверяем подпись
        if (!isDev && !skipVerify) {
            if (!botToken) {
                console.error('❌ BOT_TOKEN не настроен!');
                return res.status(HTTP.INTERNAL_ERROR).json({
                    success: false,
                    error: 'Server configuration error',
                });
            }
            
            if (!verifyTelegramWebAppData(initData, botToken)) {
                console.warn('⚠️ Невалидные Telegram данные');
                return res.status(HTTP.UNAUTHORIZED).json({
                    success: false,
                    error: 'Invalid Telegram authentication',
                });
            }
        }
        
        // Извлекаем данные пользователя
        const telegramUser = extractTelegramUser(initData);
        
        if (!telegramUser) {
            return res.status(HTTP.BAD_REQUEST).json({
                success: false,
                error: 'Could not extract user data',
            });
        }
        
        req.telegramUser = telegramUser;
        req.authMethod = 'telegram';
        return next();
    }
    
    // Режим 2: Session ID (только для development или если разрешено)
    if (sessionId) {
        const allowSessionAuth = isDev || process.env.ALLOW_SESSION_AUTH === 'true';
        
        if (!allowSessionAuth) {
            return res.status(HTTP.UNAUTHORIZED).json({
                success: false,
                error: 'Session authentication not allowed in production',
            });
        }
        
        req.sessionId = sessionId;
        req.authMethod = 'session';
        return next();
    }
    
    // Нет аутентификации
    return res.status(HTTP.UNAUTHORIZED).json({
        success: false,
        error: 'Authentication required',
    });
}

/**
 * Опциональная аутентификация (не блокирует запрос)
 */
function optionalTelegramAuth(req, res, next) {
    const { initData, sessionId } = req.body;
    const botToken = process.env.BOT_TOKEN;
    const isDev = process.env.NODE_ENV === 'development';
    
    if (initData) {
        // Пытаемся верифицировать, но не блокируем при ошибке
        if (isDev || !botToken || verifyTelegramWebAppData(initData, botToken)) {
            req.telegramUser = extractTelegramUser(initData);
            req.authMethod = 'telegram';
        }
    } else if (sessionId) {
        req.sessionId = sessionId;
        req.authMethod = 'session';
    }
    
    next();
}

module.exports = {
    verifyTelegramWebAppData,
    extractTelegramUser,
    telegramAuthMiddleware,
    optionalTelegramAuth,
};

