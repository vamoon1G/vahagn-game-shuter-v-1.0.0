/**
 * Константы приложения
 * Все магические числа и лимиты вынесены сюда
 */

module.exports = {
    // Лимиты для валидации результатов игры
    GAME: {
        MIN_DURATION_MS: 1000,        // Минимум 1 секунда игры
        MAX_DURATION_MS: 3600000,     // Максимум 1 час
        // Античит: реалистичные лимиты
        // - 1 попадание/сек × 1000 очков (макс комбо) = 60,000 очков/мин теоретический макс
        // - Ставим 100,000 с запасом для легитимных игроков
        MAX_SCORE_PER_MINUTE: 100000, // Максимум очков в минуту (античит)
        MAX_HITS_PER_MINUTE: 120,     // Максимум попаданий в минуту (2/сек — реалистично)
        MAX_ACCURACY: 1.0,            // 100%
        MIN_ACCURACY: 0.0,            // 0%
        MAX_COMBO: 100,               // Максимальное комбо
        MAX_SCORE: 10000000,          // Максимум очков за игру (10 млн)
    },
    
    // Лимиты для пользователей
    USER: {
        USERNAME_MIN_LENGTH: 2,
        USERNAME_MAX_LENGTH: 32,
        USERNAME_PATTERN: /^[a-zA-Z0-9_а-яА-ЯёЁ]+$/,
    },
    
    // Пагинация
    PAGINATION: {
        DEFAULT_LIMIT: 10,
        MAX_LIMIT: 100,
    },
    
    // Типы рейтингов
    LEADERBOARD_TYPES: ['score', 'hits', 'accuracy', 'duration'],
    
    // HTTP статусы
    HTTP: {
        OK: 200,
        CREATED: 201,
        BAD_REQUEST: 400,
        UNAUTHORIZED: 401,
        NOT_FOUND: 404,
        TOO_MANY_REQUESTS: 429,
        INTERNAL_ERROR: 500,
    },
};

