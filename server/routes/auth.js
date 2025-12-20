/**
 * Аутентификация и управление пользователями
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { HTTP } = require('../config/constants');
const { 
    telegramAuthMiddleware,
    extractTelegramUser,
    verifyTelegramWebAppData 
} = require('../middleware/telegramAuth');

/**
 * POST /api/auth/telegram
 * Аутентификация через Telegram Web App
 */
router.post('/telegram', async (req, res, next) => {
    try {
        const { initData } = req.body;
        const botToken = process.env.BOT_TOKEN;
        const isDev = process.env.NODE_ENV === 'development';
        const skipVerify = process.env.SKIP_TELEGRAM_VERIFY === 'true';
        
        if (!initData) {
            return res.status(HTTP.BAD_REQUEST).json({
                success: false,
                error: 'initData is required',
            });
        }
        
        // Верификация (пропускаем в dev режиме если настроено)
        if (!isDev && !skipVerify) {
            if (!botToken) {
                return res.status(HTTP.INTERNAL_ERROR).json({
                    success: false,
                    error: 'Bot token not configured',
                });
            }
            
            if (!verifyTelegramWebAppData(initData, botToken)) {
                return res.status(HTTP.UNAUTHORIZED).json({
                    success: false,
                    error: 'Invalid Telegram data',
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
        
        // Находим или создаём пользователя
        let [user] = await db.query(
            'SELECT * FROM users WHERE telegram_id = ?',
            [telegramUser.telegramId]
        );
        
        if (!user) {
            // Создаём нового пользователя
            const result = await db.query(
                `INSERT INTO users (telegram_id, username, session_id) 
                 VALUES (?, ?, UUID())
                 ON DUPLICATE KEY UPDATE 
                 username = VALUES(username),
                 updated_at = CURRENT_TIMESTAMP`,
                [telegramUser.telegramId, telegramUser.username]
            );
            
            [user] = await db.query(
                'SELECT * FROM users WHERE telegram_id = ?',
                [telegramUser.telegramId]
            );
        } else {
            // Обновляем username если изменился
            if (telegramUser.username && telegramUser.username !== user.username) {
                await db.query(
                    'UPDATE users SET username = ? WHERE telegram_id = ?',
                    [telegramUser.username, telegramUser.telegramId]
                );
            }
        }
        
        // Получаем статистику пользователя
        const [stats] = await db.query(
            `SELECT 
                COUNT(*) as totalGames,
                COALESCE(MAX(score), 0) as bestScore,
                COALESCE(SUM(targets_hit), 0) as totalHits
             FROM scores 
             WHERE user_id = ?`,
            [user.id]
        );
        
        res.json({
            success: true,
            data: {
                userId: user.id,
                telegramId: telegramUser.telegramId,
                username: telegramUser.username || user.username,
                firstName: telegramUser.firstName,
                stats: stats || { totalGames: 0, bestScore: 0, totalHits: 0 },
            },
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/auth/dev
 * Аутентификация для разработки (только в dev режиме!)
 */
router.post('/dev', async (req, res, next) => {
    const isDev = process.env.NODE_ENV === 'development';
    
    if (!isDev) {
        return res.status(HTTP.NOT_FOUND).json({
            success: false,
            error: 'Not available in production',
        });
    }
    
    try {
        const { sessionId, mockTelegramId } = req.body;
        
        if (!sessionId) {
            return res.status(HTTP.BAD_REQUEST).json({
                success: false,
                error: 'sessionId is required',
            });
        }
        
        // Находим или создаём dev-пользователя
        let [user] = await db.query(
            'SELECT * FROM users WHERE session_id = ?',
            [sessionId]
        );
        
        if (!user) {
            const result = await db.query(
                `INSERT INTO users (session_id, telegram_id, username) 
                 VALUES (?, ?, ?)`,
                [sessionId, mockTelegramId || 999999999, 'dev_user']
            );
            
            [user] = await db.query(
                'SELECT * FROM users WHERE session_id = ?',
                [sessionId]
            );
        }
        
        res.json({
            success: true,
            data: {
                userId: user.id,
                sessionId: user.session_id,
                username: user.username || 'dev_user',
                isDev: true,
            },
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/auth/me
 * Получить текущего пользователя
 */
router.get('/me', async (req, res, next) => {
    try {
        const telegramId = req.query.telegramId;
        const sessionId = req.query.sessionId;
        
        if (!telegramId && !sessionId) {
            return res.status(HTTP.BAD_REQUEST).json({
                success: false,
                error: 'telegramId or sessionId required',
            });
        }
        
        let user;
        if (telegramId) {
            [user] = await db.query(
                'SELECT * FROM users WHERE telegram_id = ?',
                [telegramId]
            );
        } else {
            [user] = await db.query(
                'SELECT * FROM users WHERE session_id = ?',
                [sessionId]
            );
        }
        
        if (!user) {
            return res.status(HTTP.NOT_FOUND).json({
                success: false,
                error: 'User not found',
            });
        }
        
        // Статистика
        const [stats] = await db.query(
            `SELECT 
                COUNT(*) as totalGames,
                COALESCE(MAX(score), 0) as bestScore,
                COALESCE(SUM(targets_hit), 0) as totalHits,
                COALESCE(MAX(max_combo), 0) as bestCombo
             FROM scores 
             WHERE user_id = ?`,
            [user.id]
        );
        
        res.json({
            success: true,
            data: {
                userId: user.id,
                telegramId: user.telegram_id,
                username: user.username,
                stats: stats || {},
            },
        });
        
    } catch (error) {
        next(error);
    }
});

module.exports = router;

