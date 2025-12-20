/**
 * AR Gesture Shooter - Backend API
 * 
 * Безопасный и производительный сервер для хранения рейтингов
 * 
 * @author vahagn & co
 * @version 1.0.0
 */

// Загружаем переменные окружения первым делом
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const db = require('./config/database');
const {
    httpsRedirect,
    setupHelmet,
    createApiLimiter,
    setupCors,
    requestLogger,
    errorHandler,
    notFoundHandler,
} = require('./middleware/security');
const scoresRouter = require('./routes/scores');
const authRouter = require('./routes/auth');

// ============================================
// КОНФИГУРАЦИЯ
// ============================================

const PORT = parseInt(process.env.PORT, 10) || 3001;
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT, 10) || 3443;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ============================================
// ПРОВЕРКА КРИТИЧЕСКИХ ПЕРЕМЕННЫХ (Production)
// ============================================

function validateProductionConfig() {
    const errors = [];
    
    if (NODE_ENV === 'production') {
        // BOT_TOKEN обязателен в production
        if (!process.env.BOT_TOKEN) {
            errors.push('BOT_TOKEN не установлен! Telegram верификация не будет работать.');
        }
        
        // ALLOWED_ORIGINS должен быть настроен
        if (!process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS === 'http://localhost:3000') {
            console.warn('⚠️ ALLOWED_ORIGINS не настроен для production!');
        }
        
        // Рекомендации по SSL
        if (!process.env.SSL_KEY_PATH || !process.env.SSL_CERT_PATH) {
            console.warn('⚠️ SSL сертификаты не настроены. Рекомендуется использовать HTTPS в production.');
        }
    }
    
    if (errors.length > 0) {
        console.error('❌ КРИТИЧЕСКИЕ ОШИБКИ КОНФИГУРАЦИИ:');
        errors.forEach(e => console.error(`   - ${e}`));
        
        if (NODE_ENV === 'production') {
            process.exit(1); // Не запускаемся в production без критичных настроек
        }
    }
}

validateProductionConfig();

// ============================================
// ИНИЦИАЛИЗАЦИЯ EXPRESS
// ============================================

const app = express();

// Trust proxy для корректного определения IP за nginx/cloudflare
app.set('trust proxy', 1);

// ============================================
// MIDDLEWARE (порядок важен!)
// ============================================

// 0. HTTPS redirect (в production)
app.use(httpsRedirect);

// 1. Логирование запросов
app.use(requestLogger);

// 2. Защита HTTP заголовков
app.use(setupHelmet());

// 3. CORS
app.use(setupCors());

// 4. Rate limiting
app.use('/api', createApiLimiter());

// 5. Парсинг JSON с лимитом размера
app.use(express.json({ 
    limit: '10kb',  // Защита от больших payload
    strict: true,   // Только JSON объекты/массивы
}));

// 6. Парсинг URL-encoded
app.use(express.urlencoded({ 
    extended: false, 
    limit: '10kb',
}));

// ============================================
// СТАТИЧЕСКИЕ ФАЙЛЫ (Frontend)
// ============================================
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath, {
    extensions: ['html'],
    index: 'index.html',
}));

// ============================================
// МАРШРУТЫ
// ============================================

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '1.0.0',
    });
});

// API маршруты
app.use('/api/auth', authRouter);
app.use('/api/scores', scoresRouter);

// API информация
app.get('/api', (req, res) => {
    res.json({
        name: 'AR Gesture Shooter API',
        version: '1.0.0',
        endpoints: {
            'POST /api/scores': 'Сохранить результат игры',
            'GET /api/scores/leaderboard': 'Таблица лидеров',
            'GET /api/scores/user/:sessionId': 'Статистика пользователя',
            'PUT /api/scores/user/:sessionId': 'Обновить имя пользователя',
        },
    });
});

// ============================================
// ОБРАБОТКА ОШИБОК
// ============================================

// Для всех остальных маршрутов отдаём index.html (SPA fallback)
app.get('*', (req, res, next) => {
    // Если это API запрос - пропускаем к 404
    if (req.path.startsWith('/api/')) {
        return next();
    }
    res.sendFile(path.join(frontendPath, 'index.html'));
});

// 404 для неизвестных API маршрутов
app.use(notFoundHandler);

// Глобальный обработчик ошибок
app.use(errorHandler);

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

let httpServer;
let httpsServer;

async function shutdown(signal) {
    console.log(`\n🛑 Получен ${signal}, завершаем работу...`);
    
    // Закрываем HTTP сервер
    if (httpServer) {
        httpServer.close(() => {
            console.log('🔒 HTTP сервер закрыт');
        });
    }
    
    // Закрываем HTTPS сервер
    if (httpsServer) {
        httpsServer.close(() => {
            console.log('🔒 HTTPS сервер закрыт');
        });
    }
    
    // Закрываем пул БД
    await db.closePool();
    
    console.log('✅ Сервер корректно завершён');
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Обработка необработанных ошибок
process.on('uncaughtException', (error) => {
    console.error('🔥 Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 Unhandled Rejection at:', promise, 'reason:', reason);
});

// ============================================
// ЗАПУСК СЕРВЕРА
// ============================================

async function start() {
    try {
        console.log('🚀 Запуск AR Gesture Shooter API...');
        console.log(`📍 Окружение: ${NODE_ENV}`);
        
        // Проверяем подключение к БД
        const dbConnected = await db.testConnection();
        if (!dbConnected) {
            throw new Error('Не удалось подключиться к MySQL');
        }
        
        // Инициализируем схему БД
        await db.initSchema();
        
        // Запускаем HTTP сервер
        httpServer = http.createServer(app);
        httpServer.listen(PORT, () => {
            console.log(`\n✅ HTTP сервер запущен на http://localhost:${PORT}`);
        });
        
        // Запускаем HTTPS сервер (если настроены сертификаты)
        const sslKeyPath = process.env.SSL_KEY_PATH;
        const sslCertPath = process.env.SSL_CERT_PATH;
        
        if (sslKeyPath && sslCertPath) {
            try {
                const sslOptions = {
                    key: fs.readFileSync(sslKeyPath),
                    cert: fs.readFileSync(sslCertPath),
                };
                
                // Добавляем CA если есть (для Let's Encrypt chain)
                if (process.env.SSL_CA_PATH) {
                    sslOptions.ca = fs.readFileSync(process.env.SSL_CA_PATH);
                }
                
                httpsServer = https.createServer(sslOptions, app);
                httpsServer.listen(HTTPS_PORT, () => {
                    console.log(`✅ HTTPS сервер запущен на https://localhost:${HTTPS_PORT}`);
                });
            } catch (sslError) {
                console.warn(`⚠️ Не удалось запустить HTTPS: ${sslError.message}`);
            }
        }
        
        console.log(`📡 API доступен на http://localhost:${PORT}/api`);
        console.log(`❤️  Health check: http://localhost:${PORT}/health\n`);
        
    } catch (error) {
        console.error('❌ Ошибка запуска:', error.message);
        process.exit(1);
    }
}

start();

module.exports = app; // Для тестирования

