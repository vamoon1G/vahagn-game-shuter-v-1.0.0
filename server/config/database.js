/**
 * Конфигурация и пул подключений к MySQL
 * Использует пул для эффективного переиспользования соединений
 */

const mysql = require('mysql2/promise');

// Конфигурация из переменных окружения
// Поддержка Railway (MYSQL*) и стандартных (DB_*) переменных
const dbConfig = {
    host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.MYSQLPORT || process.env.DB_PORT, 10) || 3306,
    user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
    password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
    database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'ar_shooter',
    
    // Настройки пула соединений
    waitForConnections: true,
    connectionLimit: 10,          // Максимум 10 соединений
    maxIdle: 10,                  // Максимум простаивающих
    idleTimeout: 60000,           // 60 сек таймаут простоя
    queueLimit: 0,                // Без ограничения очереди
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    
    // Безопасность
    multipleStatements: false,    // Запрет множественных запросов (защита от SQL-инъекций)
    charset: 'utf8mb4',
};

// Создаём пул соединений
let pool = null;

/**
 * Получить пул соединений (ленивая инициализация)
 */
function getPool() {
    if (!pool) {
        pool = mysql.createPool(dbConfig);
        console.log('📦 MySQL пул создан');
    }
    return pool;
}

/**
 * Выполнить запрос с prepared statement (защита от SQL-инъекций)
 * @param {string} sql - SQL запрос с плейсхолдерами ?
 * @param {Array} params - Параметры для плейсхолдеров
 * @returns {Promise<Array>} Результат запроса
 */
async function query(sql, params = []) {
    const pool = getPool();
    try {
        const [rows] = await pool.execute(sql, params);
        return rows;
    } catch (error) {
        console.error('❌ Ошибка БД:', error.message);
        throw error;
    }
}

/**
 * Получить одно соединение для транзакции
 * @returns {Promise<Connection>}
 */
async function getConnection() {
    const pool = getPool();
    return pool.getConnection();
}

/**
 * Проверка подключения к БД
 */
async function testConnection() {
    try {
        const pool = getPool();
        const connection = await pool.getConnection();
        await connection.ping();
        connection.release();
        console.log('✅ MySQL подключение успешно');
        return true;
    } catch (error) {
        console.error('❌ Ошибка подключения к MySQL:', error.message);
        return false;
    }
}

/**
 * Закрыть пул (для graceful shutdown)
 */
async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
        console.log('🔒 MySQL пул закрыт');
    }
}

/**
 * Инициализация схемы БД
 */
async function initSchema() {
    const createUsersTable = `
        CREATE TABLE IF NOT EXISTS users (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            session_id VARCHAR(36) NOT NULL UNIQUE,
            username VARCHAR(32) DEFAULT NULL,
            telegram_id BIGINT UNSIGNED DEFAULT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_telegram_id (telegram_id),
            INDEX idx_session_id (session_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;
    
    const createScoresTable = `
        CREATE TABLE IF NOT EXISTS scores (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNSIGNED NOT NULL,
            score INT UNSIGNED NOT NULL DEFAULT 0,
            targets_hit INT UNSIGNED NOT NULL DEFAULT 0,
            shots_fired INT UNSIGNED NOT NULL DEFAULT 0,
            accuracy DECIMAL(5,4) NOT NULL DEFAULT 0,
            max_combo INT UNSIGNED NOT NULL DEFAULT 1,
            duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
            game_mode VARCHAR(20) DEFAULT 'endless',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_score (score DESC),
            INDEX idx_targets (targets_hit DESC),
            INDEX idx_accuracy (accuracy DESC),
            INDEX idx_duration (duration_ms DESC),
            INDEX idx_created (created_at DESC)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;
    
    const createStatsView = `
        CREATE OR REPLACE VIEW user_stats AS
        SELECT 
            u.id as user_id,
            u.username,
            u.telegram_id,
            COUNT(s.id) as total_games,
            COALESCE(MAX(s.score), 0) as best_score,
            COALESCE(SUM(s.targets_hit), 0) as total_hits,
            COALESCE(AVG(s.accuracy), 0) as avg_accuracy,
            COALESCE(MAX(s.max_combo), 0) as best_combo,
            COALESCE(SUM(s.duration_ms), 0) as total_playtime_ms
        FROM users u
        LEFT JOIN scores s ON u.id = s.user_id
        GROUP BY u.id
    `;
    
    try {
        await query(createUsersTable);
        await query(createScoresTable);
        await query(createStatsView);
        
        // Миграция: добавляем telegram_id если его нет
        await migrateAddTelegramId();
        
        console.log('✅ Схема БД инициализирована');
    } catch (error) {
        console.error('❌ Ошибка инициализации схемы:', error.message);
        throw error;
    }
}

/**
 * Миграция: добавить telegram_id если колонка не существует
 */
async function migrateAddTelegramId() {
    try {
        // Проверяем существует ли колонка
        const [columns] = await query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'users' 
            AND COLUMN_NAME = 'telegram_id'
        `);
        
        if (!columns || (Array.isArray(columns) && columns.length === 0) || !columns.COLUMN_NAME) {
            console.log('📦 Добавляем колонку telegram_id в users...');
            await query(`
                ALTER TABLE users 
                ADD COLUMN telegram_id BIGINT UNSIGNED DEFAULT NULL UNIQUE,
                ADD INDEX idx_telegram_id (telegram_id)
            `);
            console.log('✅ Колонка telegram_id добавлена');
        }
    } catch (error) {
        // Игнорируем если колонка уже существует (duplicate column error)
        if (error.code !== 'ER_DUP_FIELDNAME' && !error.message.includes('Duplicate column')) {
            console.error('⚠️ Ошибка миграции telegram_id:', error.message);
        }
    }
}

module.exports = {
    query,
    getConnection,
    getPool,
    testConnection,
    closePool,
    initSchema,
};

