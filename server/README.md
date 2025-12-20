# AR Gesture Shooter - Backend API

Безопасный и производительный API сервер для хранения рейтингов игры.

## 🚀 Быстрый старт

### 1. Установка зависимостей

```bash
cd server
npm install
```

### 2. Настройка окружения

Создай файл `.env` в папке `server/`:

```env
# Сервер
PORT=3001
NODE_ENV=development

# База данных MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password_here
DB_NAME=ar_shooter

# CORS (разрешённые источники)
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:5500

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
```

### 3. Создание базы данных

```sql
CREATE DATABASE ar_shooter CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Таблицы создаются автоматически при первом запуске.

### 4. Запуск сервера

```bash
# Development (с hot reload)
npm run dev

# Production
npm start
```

## 📡 API Endpoints

### Health Check
```
GET /health
```
Возвращает статус сервера.

### Сохранить результат
```
POST /api/scores
Content-Type: application/json

{
    "sessionId": "uuid-v4",
    "score": 1500,
    "targetsHit": 15,
    "shotsFired": 20,
    "maxCombo": 5,
    "durationMs": 60000,
    "gameMode": "endless"
}
```

### Таблица лидеров
```
GET /api/scores/leaderboard?type=score&limit=10
```
Параметры:
- `type`: `score` | `hits` | `accuracy` | `duration`
- `limit`: 1-100 (по умолчанию 10)
- `offset`: для пагинации

### Статистика пользователя
```
GET /api/scores/user/:sessionId
```

### Обновить имя пользователя
```
PUT /api/scores/user/:sessionId
Content-Type: application/json

{
    "username": "Player123"
}
```

## 🔒 Безопасность

### Реализованные меры:

1. **SQL Injection защита**
   - Prepared statements для всех запросов
   - `multipleStatements: false` в MySQL конфигурации

2. **XSS защита**
   - Санитизация всех входных данных
   - Helmet для HTTP заголовков

3. **Rate Limiting**
   - Общий лимит: 100 запросов/минуту
   - Отправка результатов: 10/минуту

4. **Валидация данных**
   - express-validator для всех endpoints
   - Античит проверки (реалистичность результатов)

5. **CORS**
   - Настраиваемый список разрешённых источников

## 📊 Структура базы данных

### Таблица `users`
| Поле | Тип | Описание |
|------|-----|----------|
| id | INT | Primary key |
| session_id | VARCHAR(36) | UUID сессии |
| username | VARCHAR(32) | Имя игрока |
| telegram_id | BIGINT | Telegram ID |
| created_at | TIMESTAMP | Дата создания |

### Таблица `scores`
| Поле | Тип | Описание |
|------|-----|----------|
| id | INT | Primary key |
| user_id | INT | Foreign key -> users |
| score | INT | Очки |
| targets_hit | INT | Попаданий |
| shots_fired | INT | Выстрелов |
| accuracy | DECIMAL(5,4) | Точность |
| max_combo | INT | Максимальное комбо |
| duration_ms | INT | Длительность |
| game_mode | VARCHAR(20) | Режим игры |
| created_at | TIMESTAMP | Дата игры |

## 🛠 Разработка

### Структура проекта

```
server/
├── index.js              # Точка входа
├── package.json          # Зависимости
├── .env                  # Конфигурация (не в git)
├── config/
│   ├── constants.js      # Константы приложения
│   └── database.js       # MySQL подключение
├── middleware/
│   ├── security.js       # CORS, Rate Limit, Helmet
│   └── validation.js     # Валидация данных
└── routes/
    └── scores.js         # API маршруты
```

### Логирование

В development режиме все запросы логируются:
```
📡 GET /api/scores/leaderboard 200 15ms
❌ POST /api/scores 400 3ms
```

## 🚢 Production

1. Используй `NODE_ENV=production`
2. Настрой reverse proxy (nginx)
3. Включи HTTPS
4. Используй PM2 для управления процессом:

```bash
npm install -g pm2
pm2 start index.js --name "ar-shooter-api"
pm2 save
```

## 📝 Лицензия

© 2025-2026 vahagn & co. Все права защищены.

