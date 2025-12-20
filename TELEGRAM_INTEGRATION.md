# 🔗 Интеграция с Telegram Web App

## Содержание
1. [Что такое Telegram Web App](#что-такое-telegram-web-app)
2. [Архитектура интеграции](#архитектура-интеграции)
3. [Автоматическая идентификация пользователя](#автоматическая-идентификация-пользователя)
4. [Режимы разработки и продакшена](#режимы-разработки-и-продакшена)
5. [Безопасность: дыры и их закрытие](#безопасность-дыры-и-их-закрытие)
6. [Возможные баги](#возможные-баги)
7. [План реализации](#план-реализации)

---

## Что такое Telegram Web App

Telegram Web App (TWA) — это веб-приложение, которое открывается внутри Telegram. Telegram передаёт данные о пользователе через JavaScript API.

### Как это работает:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Telegram      │────▶│   Web App       │────▶│   Backend       │
│   (клиент)      │     │   (frontend)    │     │   (API)         │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        │  initData             │  Verify initData      │
        │  (подписанные         │  + Extract user       │
        │   данные юзера)       │                       │
        ▼                       ▼                       ▼
   Telegram ID            JavaScript API          Проверка подписи
   Username               window.Telegram         BOT_TOKEN
   First/Last name        WebApp object           HMAC-SHA256
```

### Данные, которые Telegram передаёт:

```javascript
// window.Telegram.WebApp.initDataUnsafe
{
    query_id: "AAHdF6...",
    user: {
        id: 123456789,              // Уникальный Telegram ID
        first_name: "Вагаг",
        last_name: "Налан",
        username: "Mr_Aregak",      // @username (может быть null)
        language_code: "ru",
        is_premium: true,           // Telegram Premium
        photo_url: "https://..."    // Аватар (опционально)
    },
    auth_date: 1234567890,
    hash: "abc123..."               // Подпись для проверки
}
```

---

## Архитектура интеграции

### Текущая архитектура (без Telegram):

```
Browser ──────▶ Frontend ──────▶ Backend ──────▶ MySQL
                   │
                   └── sessionId (localStorage UUID)
```

### Новая архитектура (с Telegram):

```
Telegram App ──▶ Frontend ──────▶ Backend ──────▶ MySQL
                    │                 │
                    │  initData       │  Verify hash
                    │  (от Telegram)  │  (BOT_TOKEN)
                    ▼                 ▼
              Auto-login         Безопасная
              по Telegram ID     аутентификация
```

---

## Автоматическая идентификация пользователя

### Как получить данные пользователя на Frontend:

```javascript
// Проверяем, запущено ли в Telegram
function getTelegramUser() {
    // Telegram Web App API
    const tg = window.Telegram?.WebApp;
    
    if (!tg) {
        console.log('Не в Telegram — используем обычный режим');
        return null;
    }
    
    // Сообщаем Telegram, что приложение готово
    tg.ready();
    
    // Получаем данные пользователя (НЕ ВЕРИФИЦИРОВАННЫЕ!)
    const user = tg.initDataUnsafe?.user;
    
    if (!user) {
        console.log('Telegram не передал данные пользователя');
        return null;
    }
    
    return {
        telegramId: user.id,
        username: user.username || `user_${user.id}`,
        firstName: user.first_name,
        lastName: user.last_name,
        isPremium: user.is_premium || false,
        photoUrl: user.photo_url,
        // RAW данные для верификации на сервере
        initData: tg.initData,  // ← ЭТО ВАЖНО для безопасности!
    };
}
```

### ⚠️ ВАЖНО: Верификация на Backend

**Данные из `initDataUnsafe` можно подделать!**  
Всегда проверяй `initData` на сервере.

```javascript
// Backend: routes/auth.js
const crypto = require('crypto');

function verifyTelegramWebAppData(initData, botToken) {
    // 1. Парсим initData (это URL-encoded строка)
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
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
    
    // 5. Сравниваем хеши
    return calculatedHash === hash;
}

// Использование:
app.post('/api/auth/telegram', (req, res) => {
    const { initData } = req.body;
    
    if (!verifyTelegramWebAppData(initData, process.env.BOT_TOKEN)) {
        return res.status(401).json({ error: 'Invalid Telegram data' });
    }
    
    // Данные верифицированы — можно доверять!
    const urlParams = new URLSearchParams(initData);
    const user = JSON.parse(urlParams.get('user'));
    
    // Создаём/обновляем пользователя в БД
    // ...
});
```

---

## Режимы разработки и продакшена

### Проблема:
- В **development** нет доступа к Telegram API (открываем в браузере)
- В **production** данные приходят от Telegram

### Решение: Режим мока

```javascript
// frontend/js/telegram.js

const TelegramService = {
    isDev: window.location.hostname === 'localhost',
    
    // Мок-данные для разработки
    mockUser: {
        id: 999999999,
        first_name: 'Dev',
        last_name: 'User',
        username: 'dev_user',
        language_code: 'ru',
    },
    
    getUser() {
        // В development — используем мок
        if (this.isDev && !window.Telegram?.WebApp) {
            console.warn('🔧 DEV MODE: Используем мок-пользователя');
            return {
                telegramId: this.mockUser.id,
                username: this.mockUser.username,
                firstName: this.mockUser.first_name,
                initData: null,  // Нет верификации в dev
                isMock: true,
            };
        }
        
        // В production — реальные данные от Telegram
        const tg = window.Telegram?.WebApp;
        if (!tg?.initDataUnsafe?.user) {
            return null;
        }
        
        tg.ready();
        const user = tg.initDataUnsafe.user;
        
        return {
            telegramId: user.id,
            username: user.username || `user_${user.id}`,
            firstName: user.first_name,
            initData: tg.initData,
            isMock: false,
        };
    },
    
    // Проверяем, запущено ли в Telegram
    isInTelegram() {
        return !!window.Telegram?.WebApp?.initData;
    },
};
```

### Backend: Разные режимы аутентификации

```javascript
// middleware/auth.js

async function authenticateUser(req, res, next) {
    const { initData, sessionId } = req.body;
    
    // Режим 1: Telegram Web App (production)
    if (initData) {
        if (!verifyTelegramWebAppData(initData, process.env.BOT_TOKEN)) {
            return res.status(401).json({ error: 'Invalid Telegram auth' });
        }
        
        const urlParams = new URLSearchParams(initData);
        const telegramUser = JSON.parse(urlParams.get('user'));
        
        // Находим или создаём пользователя по Telegram ID
        req.user = await findOrCreateUserByTelegram(telegramUser);
        return next();
    }
    
    // Режим 2: Session ID (development или не-Telegram)
    if (sessionId) {
        // В development разрешаем без верификации
        if (process.env.NODE_ENV === 'development') {
            req.user = await findOrCreateUserBySession(sessionId);
            return next();
        }
        
        // В production session-only режим отключен
        return res.status(401).json({ error: 'Telegram auth required' });
    }
    
    return res.status(401).json({ error: 'No authentication provided' });
}
```

### Переменные окружения:

```env
# .env.development
NODE_ENV=development
ALLOW_SESSION_AUTH=true      # Разрешить вход без Telegram
SKIP_TELEGRAM_VERIFY=true    # Не проверять подпись (только для dev!)

# .env.production
NODE_ENV=production
BOT_TOKEN=123456:ABC-DEF...  # Токен от @BotFather
ALLOW_SESSION_AUTH=false
SKIP_TELEGRAM_VERIFY=false
```

---

## Безопасность: дыры и их закрытие

### 🔴 КРИТИЧЕСКИЕ ДЫРЫ

#### 1. Отсутствие верификации Telegram данных

**Проблема:**
```javascript
// ❌ ОПАСНО: Данные из initDataUnsafe можно подделать!
const user = window.Telegram.WebApp.initDataUnsafe.user;
await api.saveScore({ telegramId: user.id, score: 999999 });
```

**Атака:**
```javascript
// Злоумышленник в DevTools:
window.Telegram = {
    WebApp: {
        initDataUnsafe: {
            user: { id: 1, username: 'admin' }  // Подделка!
        }
    }
};
```

**Решение:**
- ВСЕГДА верифицировать `initData` на сервере
- Использовать HMAC-SHA256 с BOT_TOKEN

---

#### 2. SQL Injection в LIMIT/OFFSET (ИСПРАВЛЕНО)

**Было:**
```javascript
// ❌ ОПАСНО: Строковые значения в LIMIT
const leaders = await db.query(
    `SELECT * FROM scores LIMIT ? OFFSET ?`,
    [limit, offset]  // Могут быть строками!
);
```

**Стало:**
```javascript
// ✅ БЕЗОПАСНО: Числа встроены в запрос
const limitNum = Number(limit);
const offsetNum = Number(offset);
const leaders = await db.query(
    `SELECT * FROM scores LIMIT ${limitNum} OFFSET ${offsetNum}`,
    []
);
```

---

#### 3. Отсутствие rate limiting на критичных эндпоинтах

**Проблема:**
Злоумышленник может спамить результатами, заполняя БД.

**Текущее состояние:** ✅ Rate limiting есть (10 req/min на `/api/scores`)

**Дополнительно нужно:**
```javascript
// Ограничить по Telegram ID, а не только по IP
const userLimiter = rateLimit({
    keyGenerator: (req) => req.user?.telegramId || req.ip,
    max: 5,  // 5 результатов в минуту на пользователя
});
```

---

#### 4. Античит: Нереалистичные результаты

**Проблема:**
Можно отправить `{ score: 1000000, duration: 1000 }` — миллион очков за 1 секунду.

**Текущее состояние:** ✅ Есть базовая проверка

**Нужно усилить:**
```javascript
// Добавить проверки:
const checks = {
    // Максимум 100 очков за попадание * макс комбо 10 = 1000 очков/попадание
    maxScorePerHit: 1000,
    // Максимум 1 выстрел в 350ms (SHOOT_COOLDOWN)
    maxShotsPerSecond: 3,
    // Точность > 99% подозрительна
    suspiciousAccuracy: 0.99,
};

if (score > targetsHit * checks.maxScorePerHit) {
    return res.status(400).json({ error: 'Suspicious score' });
}
```

---

### 🟡 СРЕДНИЕ ДЫРЫ

#### 5. XSS через username

**Проблема:**
Telegram username может содержать спецсимволы.

**Текущее состояние:** ✅ Есть `escapeHtml()` на фронтенде

**Дополнительно на бэкенде:**
```javascript
// Санитизация при сохранении
const cleanUsername = username
    .replace(/[<>&"']/g, '')
    .substring(0, 32);
```

---

#### 6. Нет HTTPS в development

**Проблема:**
Telegram Web App требует HTTPS (кроме localhost).

**Решение для тестирования:**
```bash
# Используй ngrok для HTTPS туннеля
ngrok http 3001
# Получишь https://abc123.ngrok.io
```

---

#### 7. CORS слишком открытый в development

**Проблема:**
```javascript
if (process.env.NODE_ENV === 'development') {
    res.header('Access-Control-Allow-Origin', '*');  // ❌ Всё разрешено
}
```

**Решение:**
```javascript
const allowedOrigins = [
    'http://localhost:3001',
    'https://your-app.telegram.org',
];
```

---

### 🟢 МЕЛКИЕ ПРОБЛЕМЫ

#### 8. Логирование sensitive данных

**Проблема:**
```javascript
console.log('User data:', req.body);  // Может содержать токены
```

**Решение:**
```javascript
const sanitizeLog = (obj) => {
    const copy = { ...obj };
    delete copy.initData;
    delete copy.hash;
    return copy;
};
console.log('User data:', sanitizeLog(req.body));
```

---

## Возможные баги

### 🐛 Баги Frontend

| # | Баг | Причина | Решение |
|---|-----|---------|---------|
| 1 | Прицел исчезает при быстром движении | `smoothedAimPosition` отстаёт | Увеличить `sensitivity` |
| 2 | Двойной выстрел | `SHOOT_COOLDOWN` не проверяется в `checkJerk` | Проверять cooldown раньше |
| 3 | Игра не ставится на паузу при сворачивании | Нет обработки `visibilitychange` | Добавить `document.addEventListener('visibilitychange')` |
| 4 | Память утекает при долгой игре | Частицы не очищаются при выходе | Добавить `cleanup()` в `exitGame` |
| 5 | Камера остаётся активной после выхода | `srcObject.getTracks().stop()` не всегда вызывается | Вызывать в `finally` блоке |

### 🐛 Баги Backend

| # | Баг | Причина | Решение |
|---|-----|---------|---------|
| 1 | `rank` — reserved word | MySQL 8.0+ | ✅ Исправлено (экранирование) |
| 2 | Пул соединений не закрывается | Нет graceful shutdown в некоторых случаях | Добавить `process.on('beforeExit')` |
| 3 | Дубликаты пользователей | Race condition при создании | Использовать `INSERT ... ON DUPLICATE KEY UPDATE` |
| 4 | Таймзоны в датах | MySQL и Node.js могут быть в разных TZ | Использовать UTC везде |

### 🐛 Баги интеграции

| # | Баг | Причина | Решение |
|---|-----|---------|---------|
| 1 | Telegram Web App не открывается | CSP блокирует | Добавить `https://telegram.org` в CSP |
| 2 | Кнопка "Назад" не работает | Telegram перехватывает | Использовать `tg.BackButton` |
| 3 | Клавиатура перекрывает UI | На мобильных | Использовать `tg.MainButton` вместо HTML кнопок |
| 4 | Тёмная тема не применяется | Не читаем `tg.colorScheme` | Добавить поддержку темы |

---

## План реализации

### Этап 1: Подготовка (1-2 часа)

- [ ] Создать Telegram бота через @BotFather
- [ ] Получить BOT_TOKEN
- [ ] Настроить Web App URL в боте
- [ ] Добавить переменные окружения

### Этап 2: Backend (2-3 часа)

- [ ] Создать `/api/auth/telegram` endpoint
- [ ] Реализовать `verifyTelegramWebAppData()`
- [ ] Обновить схему БД (добавить `telegram_id` индекс)
- [ ] Добавить middleware аутентификации
- [ ] Написать тесты

### Этап 3: Frontend (2-3 часа)

- [ ] Подключить Telegram Web App SDK
- [ ] Создать `TelegramService`
- [ ] Обновить `SessionManager` для работы с Telegram
- [ ] Добавить UI для Telegram (тема, кнопки)
- [ ] Тестирование в BotFather Test Environment

### Этап 4: Тестирование (1-2 часа)

- [ ] Тест в браузере (dev mode)
- [ ] Тест через ngrok в Telegram
- [ ] Тест на реальном устройстве
- [ ] Проверка безопасности

### Этап 5: Деплой

- [ ] Настроить HTTPS (Let's Encrypt)
- [ ] Задеплоить на сервер
- [ ] Обновить Web App URL в боте
- [ ] Опубликовать бота

---

## Полезные ссылки

- [Telegram Web Apps Documentation](https://core.telegram.org/bots/webapps)
- [Telegram Web App JS SDK](https://telegram.org/js/telegram-web-app.js)
- [BotFather](https://t.me/BotFather)
- [Test Environment](https://core.telegram.org/bots/webapps#testing-mini-apps)

---

*Документ создан: Декабрь 2024*  
*Автор: vahagn & co*

