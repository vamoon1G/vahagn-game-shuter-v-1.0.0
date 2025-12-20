/**
 * Middleware безопасности
 * Rate limiting, CORS, защита заголовков, HTTPS
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { HTTP } = require('../config/constants');

/**
 * HTTPS redirect в production
 * Перенаправляет HTTP запросы на HTTPS
 */
function httpsRedirect(req, res, next) {
    // Пропускаем в development
    if (process.env.NODE_ENV !== 'production') {
        return next();
    }
    
    // Пропускаем если уже HTTPS
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
        return next();
    }
    
    // Пропускаем health check
    if (req.path === '/health') {
        return next();
    }
    
    // Редирект на HTTPS
    const httpsUrl = `https://${req.hostname}${req.originalUrl}`;
    res.redirect(301, httpsUrl);
}

/**
 * Настройка helmet для защиты HTTP заголовков
 */
function setupHelmet() {
    return helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                // 'unsafe-eval' и 'wasm-unsafe-eval' нужны для MediaPipe WASM
                scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", "unpkg.com", "cdn.jsdelivr.net", "blob:"],
                styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
                fontSrc: ["'self'", "fonts.gstatic.com"],
                imgSrc: ["'self'", "data:", "blob:"],
                connectSrc: ["'self'", "unpkg.com", "cdn.jsdelivr.net", "blob:"],
                mediaSrc: ["'self'", "blob:"],
                workerSrc: ["'self'", "blob:"], // Для Web Workers
            },
        },
        crossOriginEmbedderPolicy: false, // Для работы с камерой
        crossOriginOpenerPolicy: false,   // Для SharedArrayBuffer
    });
}

/**
 * Общий rate limiter для API
 */
function createApiLimiter() {
    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000;
    const max = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100;
    
    return rateLimit({
        windowMs,
        max,
        message: {
            success: false,
            error: 'Слишком много запросов. Попробуйте позже.',
        },
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => {
            // Используем IP + User-Agent для идентификации
            return `${req.ip}-${req.get('User-Agent') || 'unknown'}`;
        },
        skip: (req) => {
            // Пропускаем OPTIONS запросы
            return req.method === 'OPTIONS';
        },
    });
}

/**
 * Строгий rate limiter для отправки результатов (античит)
 */
function createScoreLimiter() {
    return rateLimit({
        windowMs: 60000,   // 1 минута
        max: 10,           // Максимум 10 отправок в минуту
        message: {
            success: false,
            error: 'Слишком частая отправка результатов.',
        },
        standardHeaders: true,
        legacyHeaders: false,
    });
}

/**
 * Настройка CORS
 */
function setupCors() {
    const allowedOriginsStr = process.env.ALLOWED_ORIGINS || 'http://localhost:3000';
    const allowedOrigins = allowedOriginsStr.split(',').map(o => o.trim());
    
    return (req, res, next) => {
        const origin = req.get('Origin');
        
        // В development разрешаем все
        if (process.env.NODE_ENV === 'development') {
            res.header('Access-Control-Allow-Origin', origin || '*');
        } else if (origin && allowedOrigins.includes(origin)) {
            res.header('Access-Control-Allow-Origin', origin);
        }
        
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Id');
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Access-Control-Max-Age', '86400'); // 24 часа кэш preflight
        
        // Handle preflight
        if (req.method === 'OPTIONS') {
            return res.sendStatus(HTTP.OK);
        }
        
        next();
    };
}

/**
 * Логирование запросов
 */
function requestLogger(req, res, next) {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        const log = `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`;
        
        if (res.statusCode >= 400) {
            console.error(`❌ ${log}`);
        } else if (process.env.NODE_ENV === 'development') {
            console.log(`📡 ${log}`);
        }
    });
    
    next();
}

/**
 * Обработчик ошибок
 */
function errorHandler(err, req, res, next) {
    console.error('🔥 Ошибка:', err);
    
    // Не раскрываем детали ошибок в production
    const isDev = process.env.NODE_ENV === 'development';
    
    res.status(err.status || HTTP.INTERNAL_ERROR).json({
        success: false,
        error: isDev ? err.message : 'Внутренняя ошибка сервера',
        ...(isDev && { stack: err.stack }),
    });
}

/**
 * Обработчик 404
 */
function notFoundHandler(req, res) {
    res.status(HTTP.NOT_FOUND).json({
        success: false,
        error: 'Маршрут не найден',
    });
}

module.exports = {
    httpsRedirect,
    setupHelmet,
    createApiLimiter,
    createScoreLimiter,
    setupCors,
    requestLogger,
    errorHandler,
    notFoundHandler,
};

