/**
 * Telegram Web App Service
 * Обеспечивает работу с Telegram API и fallback для разработки
 */

const TelegramService = {
    _user: null,
    _initialized: false,
    
    /**
     * Инициализация сервиса
     */
    init() {
        if (this._initialized) return;
        this._initialized = true;
        
        const tg = window.Telegram?.WebApp;
        
        if (tg?.initDataUnsafe?.user) {
            // Реальный Telegram Web App с данными пользователя
            tg.ready();
            tg.expand();  // Развернуть на весь экран
            
            this._user = this._extractTelegramUser(tg);
            this._applyTelegramTheme(tg);
        } else if (tg) {
            // Telegram Web App есть, но нет данных пользователя
            tg.ready();
            tg.expand();
            this._applyTelegramTheme(tg);
            this._user = null;
        } else if (this._isDevMode()) {
            // Режим разработки — используем мок
            this._user = this._createMockUser();
        } else {
            // Не в Telegram и не dev mode
            this._user = null;
        }
        
        return this._user;
    },
    
    /**
     * Проверка dev режима
     */
    _isDevMode() {
        // Проверяем глобальную конфигурацию
        if (typeof window.APP_CONFIG !== 'undefined') {
            return window.APP_CONFIG.DEV_MODE === true;
        }
        // Fallback: проверяем localhost
        return window.location.hostname === 'localhost' || 
               window.location.hostname === '127.0.0.1';
    },
    
    /**
     * Извлечение данных пользователя из Telegram
     */
    _extractTelegramUser(tg) {
        const user = tg.initDataUnsafe?.user;
        if (!user) return null;
        
        return {
            telegramId: user.id,
            username: user.username || `user_${user.id}`,
            firstName: user.first_name || '',
            lastName: user.last_name || '',
            languageCode: user.language_code || 'en',
            isPremium: user.is_premium || false,
            photoUrl: user.photo_url || null,
            // Сырые данные для верификации на сервере
            initData: tg.initData,
            // Флаг что это реальный пользователь
            isMock: false,
        };
    },
    
    /**
     * Создание мок-пользователя для разработки
     */
    _createMockUser() {
        const mockData = window.APP_CONFIG?.DEV_MOCK_USER || {
            id: 999999999,
            first_name: 'Dev',
            last_name: 'User',
            username: 'dev_user',
            language_code: 'ru',
        };
        
        return {
            telegramId: mockData.id,
            username: mockData.username,
            firstName: mockData.first_name,
            lastName: mockData.last_name,
            languageCode: mockData.language_code,
            isPremium: mockData.is_premium || false,
            photoUrl: null,
            initData: null,  // Нет initData в dev режиме
            isMock: true,    // Помечаем как мок
        };
    },
    
    /**
     * Применение темы Telegram
     * Используем только light/dark mode, без кастомных цветов Telegram
     */
    _applyTelegramTheme(tg) {
        const colorScheme = tg.colorScheme;  // 'light' или 'dark'
        
        // Применяем только тёмную/светлую тему, без цветов Telegram
        if (colorScheme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
    },
    
    /**
     * Получить текущего пользователя
     */
    getUser() {
        if (!this._initialized) {
            this.init();
        }
        return this._user;
    },
    
    /**
     * Проверка: запущено ли в Telegram
     */
    isInTelegram() {
        return !!window.Telegram?.WebApp?.initData;
    },
    
    /**
     * Проверка: есть ли пользователь (реальный или мок)
     */
    hasUser() {
        return this._user !== null;
    },
    
    /**
     * Проверка: это мок-пользователь?
     */
    isMockUser() {
        return this._user?.isMock === true;
    },
    
    /**
     * Получить initData для верификации на сервере
     */
    getInitData() {
        return this._user?.initData || null;
    },
    
    /**
     * Получить Telegram ID
     */
    getTelegramId() {
        return this._user?.telegramId || null;
    },
    
    /**
     * Получить отображаемое имя
     */
    getDisplayName() {
        if (!this._user) return 'Гость';
        return this._user.username || 
               this._user.firstName || 
               `Игрок #${this._user.telegramId}`;
    },
    
    /**
     * Показать главную кнопку Telegram
     */
    showMainButton(text, onClick) {
        const tg = window.Telegram?.WebApp;
        if (!tg?.MainButton) return false;
        
        tg.MainButton.text = text;
        tg.MainButton.onClick(onClick);
        tg.MainButton.show();
        return true;
    },
    
    /**
     * Скрыть главную кнопку
     */
    hideMainButton() {
        const tg = window.Telegram?.WebApp;
        if (tg?.MainButton) {
            tg.MainButton.hide();
        }
    },
    
    /**
     * Показать кнопку "Назад"
     */
    showBackButton(onClick) {
        const tg = window.Telegram?.WebApp;
        if (!tg?.BackButton) return false;
        
        tg.BackButton.onClick(onClick);
        tg.BackButton.show();
        return true;
    },
    
    /**
     * Скрыть кнопку "Назад"
     */
    hideBackButton() {
        const tg = window.Telegram?.WebApp;
        if (tg?.BackButton) {
            tg.BackButton.hide();
        }
    },
    
    /**
     * Закрыть Web App
     */
    close() {
        const tg = window.Telegram?.WebApp;
        if (tg) {
            tg.close();
        } else {
            window.close();
        }
    },
    
    /**
     * Вибрация (haptic feedback)
     */
    hapticFeedback(type = 'light') {
        const tg = window.Telegram?.WebApp;
        if (tg?.HapticFeedback) {
            switch (type) {
                case 'light':
                    tg.HapticFeedback.impactOccurred('light');
                    break;
                case 'medium':
                    tg.HapticFeedback.impactOccurred('medium');
                    break;
                case 'heavy':
                    tg.HapticFeedback.impactOccurred('heavy');
                    break;
                case 'success':
                    tg.HapticFeedback.notificationOccurred('success');
                    break;
                case 'error':
                    tg.HapticFeedback.notificationOccurred('error');
                    break;
            }
        }
    },
    
    /**
     * Логирование (только в dev режиме)
     */
    _log(...args) {
        if (this._isDevMode() || window.APP_CONFIG?.DEBUG_LOG) {
            console.log('[TelegramService]', ...args);
        }
    },
};

// Экспорт в глобальную область
window.TelegramService = TelegramService;

