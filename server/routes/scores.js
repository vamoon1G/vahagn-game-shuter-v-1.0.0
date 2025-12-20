/**
 * API маршруты для управления очками и рейтингами
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { PAGINATION, HTTP } = require('../config/constants');
const { 
    validateGameResult, 
    validateLeaderboardQuery 
} = require('../middleware/validation');
const { createScoreLimiter } = require('../middleware/security');

/**
 * POST /api/scores
 * Сохранить результат игры
 * Поддерживает аутентификацию через Telegram ID или Session ID
 */
router.post('/', createScoreLimiter(), validateGameResult, async (req, res, next) => {
    try {
        // Логируем входящие данные (без sensitive)
        const logBody = { ...req.body };
        delete logBody.initData;
        console.log('📥 POST /api/scores:', JSON.stringify(logBody));
        
        const { 
            sessionId,
            telegramId,  // Новое: Telegram ID
            initData,    // Новое: для верификации
            score, 
            targetsHit, 
            shotsFired, 
            maxCombo, 
            durationMs,
            gameMode = 'endless'
        } = req.body;
        
        // Вычисляем accuracy
        const accuracy = shotsFired > 0 ? targetsHit / shotsFired : 0;
        
        let userId;
        let user;
        
        // Приоритет 1: Telegram ID
        if (telegramId) {
            [user] = await db.query(
                'SELECT id FROM users WHERE telegram_id = ?',
                [telegramId]
            );
            
            if (!user) {
                // Создаём пользователя по Telegram ID
                const result = await db.query(
                    'INSERT INTO users (telegram_id, session_id) VALUES (?, UUID())',
                    [telegramId]
                );
                userId = result.insertId;
            } else {
                userId = user.id;
            }
        }
        // Приоритет 2: Session ID
        else if (sessionId) {
            [user] = await db.query(
                'SELECT id FROM users WHERE session_id = ?',
                [sessionId]
            );
            
            if (!user) {
                const result = await db.query(
                    'INSERT INTO users (session_id) VALUES (?)',
                    [sessionId]
                );
                userId = result.insertId;
            } else {
                userId = user.id;
            }
        } else {
            return res.status(HTTP.BAD_REQUEST).json({
                success: false,
                error: 'telegramId or sessionId required',
            });
        }
        
        // Сохраняем результат
        const result = await db.query(
            `INSERT INTO scores 
             (user_id, score, targets_hit, shots_fired, accuracy, max_combo, duration_ms, game_mode) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, score, targetsHit, shotsFired, accuracy, maxCombo, durationMs, gameMode]
        );
        
        // Получаем позицию в рейтинге
        const [rankResult] = await db.query(
            `SELECT COUNT(*) + 1 as \`rank\` 
             FROM scores 
             WHERE score > ?`,
            [score]
        );
        
        res.status(HTTP.CREATED).json({
            success: true,
            data: {
                scoreId: result.insertId,
                rank: rankResult?.rank || 1,
                score,
                targetsHit,
                accuracy: Math.round(accuracy * 100),
                maxCombo,
            },
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * Безопасная валидация и получение числовых значений для SQL
 * Защита от SQL-инъекций
 */
function getSafeInt(value, defaultVal, min, max) {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < min || num > max) {
        return defaultVal;
    }
    return num;
}

/**
 * GET /api/scores/leaderboard
 * Получить таблицу лидеров (лучший результат каждого игрока)
 */
router.get('/leaderboard', validateLeaderboardQuery, async (req, res, next) => {
    try {
        // Whitelist для типов рейтинга (защита от SQL-инъекций)
        const ALLOWED_TYPES = ['score', 'hits', 'accuracy'];
        const type = ALLOWED_TYPES.includes(req.query.type) ? req.query.type : 'score';
        
        // Безопасные числовые значения
        const limitNum = getSafeInt(req.query.limit, PAGINATION.DEFAULT_LIMIT, 1, PAGINATION.MAX_LIMIT);
        const offsetNum = getSafeInt(req.query.offset, 0, 0, 100000);
        
        let leaders;
        
        // Базовый SELECT для всех запросов
        const selectFields = `
            s.id,
            COALESCE(u.username, CONCAT('Игрок #', u.id)) as username,
            s.score,
            s.targets_hit as targetsHit,
            ROUND(s.accuracy * 100, 1) as accuracy,
            s.max_combo as maxCombo,
            s.duration_ms as durationMs,
            s.game_mode as gameMode,
            s.created_at as playedAt
        `;
        
        // Разные запросы для разных типов рейтинга - лучший результат каждого игрока
        // LIMIT и OFFSET безопасно интерполируются (уже провалидированы getSafeInt)
        if (type === 'score') {
            leaders = await db.query(
                `SELECT ${selectFields}
                 FROM scores s
                 INNER JOIN users u ON s.user_id = u.id
                 WHERE s.id = (
                     SELECT s2.id FROM scores s2 
                     WHERE s2.user_id = s.user_id 
                     ORDER BY s2.score DESC, s2.created_at DESC 
                     LIMIT 1
                 )
                 ORDER BY s.score DESC
                 LIMIT ${limitNum} OFFSET ${offsetNum}`
            );
        } else if (type === 'hits') {
            leaders = await db.query(
                `SELECT ${selectFields}
                 FROM scores s
                 INNER JOIN users u ON s.user_id = u.id
                 WHERE s.id = (
                     SELECT s2.id FROM scores s2 
                     WHERE s2.user_id = s.user_id 
                     ORDER BY s2.targets_hit DESC, s2.created_at DESC 
                     LIMIT 1
                 )
                 ORDER BY s.targets_hit DESC
                 LIMIT ${limitNum} OFFSET ${offsetNum}`
            );
        } else if (type === 'accuracy') {
            leaders = await db.query(
                `SELECT ${selectFields}
                 FROM scores s
                 INNER JOIN users u ON s.user_id = u.id
                 WHERE s.shots_fired >= 10
                 AND s.id = (
                     SELECT s2.id FROM scores s2 
                     WHERE s2.user_id = s.user_id AND s2.shots_fired >= 10
                     ORDER BY s2.accuracy DESC, s2.created_at DESC 
                     LIMIT 1
                 )
                 ORDER BY s.accuracy DESC
                 LIMIT ${limitNum} OFFSET ${offsetNum}`
            );
        } else {
            // Fallback - по очкам (не должен достигаться из-за whitelist выше)
            leaders = await db.query(
                `SELECT ${selectFields}
                 FROM scores s
                 INNER JOIN users u ON s.user_id = u.id
                 WHERE s.id = (
                     SELECT s2.id FROM scores s2 
                     WHERE s2.user_id = s.user_id 
                     ORDER BY s2.score DESC, s2.created_at DESC 
                     LIMIT 1
                 )
                 ORDER BY s.score DESC
                 LIMIT ${limitNum} OFFSET ${offsetNum}`
            );
        }
        
        // Добавляем rank
        const rankedLeaders = leaders.map((leader, index) => ({
            rank: offsetNum + index + 1,
            ...leader,
        }));
        
        // Получаем общее количество уникальных игроков
        const [countResult] = await db.query('SELECT COUNT(DISTINCT user_id) as total FROM scores');
        const total = countResult?.total || 0;
        
        res.json({
            success: true,
            data: {
                leaders: rankedLeaders,
                pagination: {
                    total,
                    limit: limitNum,
                    offset: offsetNum,
                    hasMore: offsetNum + limitNum < total,
                },
            },
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/scores/user/telegram/:telegramId
 * Получить статистику пользователя по Telegram ID
 */
router.get('/user/telegram/:telegramId', async (req, res, next) => {
    try {
        const { telegramId } = req.params;
        
        // Валидация telegramId (число)
        if (!/^\d+$/.test(telegramId)) {
            return res.status(HTTP.BAD_REQUEST).json({
                success: false,
                error: 'Некорректный telegramId',
            });
        }
        
        // Получаем пользователя
        const [user] = await db.query(
            'SELECT id, username, created_at FROM users WHERE telegram_id = ?',
            [telegramId]
        );
        
        if (!user) {
            return res.status(HTTP.NOT_FOUND).json({
                success: false,
                error: 'Пользователь не найден',
            });
        }
        
        // Получаем статистику
        const [stats] = await db.query(
            `SELECT 
                COUNT(*) as totalGames,
                COALESCE(MAX(score), 0) as bestScore,
                COALESCE(SUM(targets_hit), 0) as totalHits,
                COALESCE(ROUND(AVG(accuracy) * 100, 1), 0) as avgAccuracy,
                COALESCE(MAX(max_combo), 0) as bestCombo,
                COALESCE(SUM(duration_ms), 0) as totalPlaytimeMs
             FROM scores 
             WHERE user_id = ?`,
            [user.id]
        );
        
        // Получаем последние 5 игр
        const recentGames = await db.query(
            `SELECT 
                score, 
                targets_hit as targetsHit, 
                ROUND(accuracy * 100, 1) as accuracy,
                max_combo as maxCombo,
                duration_ms as durationMs,
                created_at as playedAt
             FROM scores 
             WHERE user_id = ? 
             ORDER BY created_at DESC 
             LIMIT 5`,
            [user.id]
        );
        
        // Позиция в общем рейтинге
        const [rankResult] = await db.query(
            `SELECT COUNT(*) + 1 as \`rank\` 
             FROM (
                 SELECT user_id, MAX(score) as best_score 
                 FROM scores 
                 GROUP BY user_id
             ) t 
             WHERE best_score > COALESCE((
                 SELECT MAX(score) FROM scores WHERE user_id = ?
             ), 0)`,
            [user.id]
        );
        
        res.json({
            success: true,
            data: {
                username: user.username || `Игрок #${user.id}`,
                rank: rankResult?.rank || 1,
                stats: stats || {},
                recentGames,
                memberSince: user.created_at,
            },
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/scores/user/:sessionId
 * Получить статистику пользователя
 */
router.get('/user/:sessionId', async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        
        // Валидация UUID
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(sessionId)) {
            return res.status(HTTP.BAD_REQUEST).json({
                success: false,
                error: 'Некорректный sessionId',
            });
        }
        
        // Получаем пользователя
        const [user] = await db.query(
            'SELECT id, username, created_at FROM users WHERE session_id = ?',
            [sessionId]
        );
        
        if (!user) {
            return res.status(HTTP.NOT_FOUND).json({
                success: false,
                error: 'Пользователь не найден',
            });
        }
        
        // Получаем статистику
        const [stats] = await db.query(
            `SELECT 
                COUNT(*) as totalGames,
                COALESCE(MAX(score), 0) as bestScore,
                COALESCE(SUM(targets_hit), 0) as totalHits,
                COALESCE(ROUND(AVG(accuracy) * 100, 1), 0) as avgAccuracy,
                COALESCE(MAX(max_combo), 0) as bestCombo,
                COALESCE(SUM(duration_ms), 0) as totalPlaytimeMs
             FROM scores 
             WHERE user_id = ?`,
            [user.id]
        );
        
        // Получаем последние 5 игр
        const recentGames = await db.query(
            `SELECT 
                score, 
                targets_hit as targetsHit, 
                ROUND(accuracy * 100, 1) as accuracy,
                max_combo as maxCombo,
                duration_ms as durationMs,
                created_at as playedAt
             FROM scores 
             WHERE user_id = ? 
             ORDER BY created_at DESC 
             LIMIT 5`,
            [user.id]
        );
        
        // Позиция в общем рейтинге
        const [rankResult] = await db.query(
            `SELECT COUNT(*) + 1 as \`rank\` 
             FROM (
                 SELECT user_id, MAX(score) as best_score 
                 FROM scores 
                 GROUP BY user_id
             ) t 
             WHERE best_score > COALESCE((
                 SELECT MAX(score) FROM scores WHERE user_id = ?
             ), 0)`,
            [user.id]
        );
        
        res.json({
            success: true,
            data: {
                username: user.username || `Игрок #${user.id}`,
                rank: rankResult?.rank || 1,
                stats: stats || {},
                recentGames,
                memberSince: user.created_at,
            },
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * PUT /api/scores/user/:sessionId
 * Обновить имя пользователя
 */
router.put('/user/:sessionId', async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const { username } = req.body;
        
        // Валидация UUID
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(sessionId)) {
            return res.status(HTTP.BAD_REQUEST).json({
                success: false,
                error: 'Некорректный sessionId',
            });
        }
        
        // Валидация username
        if (!username || username.length < 2 || username.length > 32) {
            return res.status(HTTP.BAD_REQUEST).json({
                success: false,
                error: 'Имя должно быть от 2 до 32 символов',
            });
        }
        
        // Санитизация
        const cleanUsername = username.trim().replace(/[<>]/g, '');
        
        // Проверяем уникальность имени
        const [existing] = await db.query(
            'SELECT id FROM users WHERE username = ? AND session_id != ?',
            [cleanUsername, sessionId]
        );
        
        if (existing) {
            return res.status(HTTP.BAD_REQUEST).json({
                success: false,
                error: 'Это имя уже занято',
            });
        }
        
        // Обновляем
        const result = await db.query(
            'UPDATE users SET username = ? WHERE session_id = ?',
            [cleanUsername, sessionId]
        );
        
        if (result.affectedRows === 0) {
            return res.status(HTTP.NOT_FOUND).json({
                success: false,
                error: 'Пользователь не найден',
            });
        }
        
        res.json({
            success: true,
            data: { username: cleanUsername },
        });
        
    } catch (error) {
        next(error);
    }
});

module.exports = router;

