/**
 * Middleware для валидации входных данных
 * Защита от некорректных данных и потенциальных атак
 */

const { body, param, query, validationResult } = require('express-validator');
const { GAME, USER, PAGINATION, LEADERBOARD_TYPES, HTTP } = require('../config/constants');

/**
 * Обработчик ошибок валидации
 */
function handleValidationErrors(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        // Безопасное логирование (без sensitive данных)
        const safeBody = { ...req.body };
        delete safeBody.initData;
        console.log('❌ Ошибка валидации:', JSON.stringify(safeBody, null, 2));
        console.log('   Ошибки:', errors.array().map(e => `${e.path}: ${e.msg}`).join(', '));
        return res.status(HTTP.BAD_REQUEST).json({
            success: false,
            error: 'Ошибка валидации',
            details: errors.array().map(err => ({
                field: err.path,
                message: err.msg,
            })),
        });
    }
    next();
}

/**
 * Санитизация строки от потенциально опасных символов
 */
function sanitizeString(value) {
    if (typeof value !== 'string') return value;
    return value
        .trim()
        .replace(/[<>]/g, '')           // Удаляем < > (XSS)
        .replace(/[\x00-\x1f]/g, '')    // Удаляем control characters
        .substring(0, 1000);             // Ограничиваем длину
}

/**
 * Валидация для отправки результата игры
 */
const validateGameResult = [
    // sessionId или telegramId — хотя бы один обязателен
    body('sessionId')
        .optional()
        .isUUID(4)
        .withMessage('Некорректный sessionId'),
    
    body('telegramId')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Некорректный telegramId')
        .toInt(),
    
    body('score')
        .isInt({ min: 0, max: GAME.MAX_SCORE })
        .withMessage(`Очки должны быть от 0 до ${GAME.MAX_SCORE}`)
        .toInt(),
    
    body('targetsHit')
        .isInt({ min: 0, max: 10000 })
        .withMessage('Некорректное количество попаданий')
        .toInt(),
    
    body('shotsFired')
        .isInt({ min: 0, max: 50000 })
        .withMessage('Некорректное количество выстрелов')
        .toInt()
        .default(0),
    
    body('maxCombo')
        .isInt({ min: 1, max: GAME.MAX_COMBO })
        .withMessage(`Комбо должно быть от 1 до ${GAME.MAX_COMBO}`)
        .toInt(),
    
    body('durationMs')
        .isInt({ min: GAME.MIN_DURATION_MS, max: GAME.MAX_DURATION_MS })
        .withMessage(`Длительность должна быть от ${GAME.MIN_DURATION_MS}ms до ${GAME.MAX_DURATION_MS}ms`)
        .toInt(),
    
    body('gameMode')
        .optional()
        .isIn(['endless', 'timed', 'accuracy', 'survival'])
        .withMessage('Некорректный режим игры'),
    
    handleValidationErrors,
    
    // Дополнительная валидация на реалистичность (античит)
    (req, res, next) => {
        const { score, targetsHit, durationMs, shotsFired } = req.body;
        const durationMin = durationMs / 60000;
        
        // Античит только для игр дольше 10 секунд (избегаем false positives для коротких игр)
        const MIN_DURATION_FOR_ANTICHEAT = 10000; // 10 секунд
        
        if (durationMs >= MIN_DURATION_FOR_ANTICHEAT && durationMin > 0) {
            const scorePerMin = score / durationMin;
            if (scorePerMin > GAME.MAX_SCORE_PER_MINUTE) {
                console.warn('❌ Античит: scorePerMin =', scorePerMin, '>', GAME.MAX_SCORE_PER_MINUTE);
                return res.status(HTTP.BAD_REQUEST).json({
                    success: false,
                    error: 'Подозрительная активность: слишком высокий счёт',
                });
            }
            
            const hitsPerMin = targetsHit / durationMin;
            if (hitsPerMin > GAME.MAX_HITS_PER_MINUTE) {
                console.warn('❌ Античит: hitsPerMin =', hitsPerMin, '>', GAME.MAX_HITS_PER_MINUTE);
                return res.status(HTTP.BAD_REQUEST).json({
                    success: false,
                    error: 'Подозрительная активность: слишком много попаданий',
                });
            }
        }
        
        // Попаданий не может быть больше выстрелов (если были выстрелы)
        if (shotsFired > 0 && targetsHit > shotsFired) {
            console.warn('❌ Античит: targetsHit =', targetsHit, '> shotsFired =', shotsFired);
            return res.status(HTTP.BAD_REQUEST).json({
                success: false,
                error: 'Некорректные данные: попаданий больше выстрелов',
            });
        }
        
        next();
    },
];

/**
 * Валидация для получения рейтинга
 */
const validateLeaderboardQuery = [
    query('type')
        .optional()
        .isIn(LEADERBOARD_TYPES)
        .withMessage(`Тип должен быть одним из: ${LEADERBOARD_TYPES.join(', ')}`),
    
    query('limit')
        .optional()
        .isInt({ min: 1, max: PAGINATION.MAX_LIMIT })
        .withMessage(`Лимит должен быть от 1 до ${PAGINATION.MAX_LIMIT}`)
        .toInt(),
    
    query('offset')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Offset должен быть >= 0')
        .toInt(),
    
    handleValidationErrors,
];

/**
 * Валидация для создания/обновления пользователя
 */
const validateUser = [
    body('username')
        .optional()
        .isLength({ min: USER.USERNAME_MIN_LENGTH, max: USER.USERNAME_MAX_LENGTH })
        .withMessage(`Имя должно быть от ${USER.USERNAME_MIN_LENGTH} до ${USER.USERNAME_MAX_LENGTH} символов`)
        .matches(USER.USERNAME_PATTERN)
        .withMessage('Имя может содержать только буквы, цифры и _')
        .customSanitizer(sanitizeString),
    
    body('telegramId')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Некорректный Telegram ID')
        .toInt(),
    
    handleValidationErrors,
];

/**
 * Валидация UUID параметра
 */
const validateSessionId = [
    param('sessionId')
        .isUUID(4)
        .withMessage('Некорректный sessionId'),
    
    handleValidationErrors,
];

module.exports = {
    validateGameResult,
    validateLeaderboardQuery,
    validateUser,
    validateSessionId,
    sanitizeString,
};

