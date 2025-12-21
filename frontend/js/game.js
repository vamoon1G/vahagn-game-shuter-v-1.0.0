'use strict';

// ============================================
// API CONFIGURATION
// ============================================
const API_CONFIG = Object.freeze({
    // Если сервер на том же origin - используем относительный путь
    BASE_URL: window.location.port === '3001' ? '/api' : 'http://localhost:3001/api',
    TIMEOUT: 30000,  // 30 секунд — Render бесплатный тариф имеет холодный старт
});

// ============================================
// SESSION MANAGEMENT (с поддержкой Telegram)
// ============================================
const SessionManager = {
    SESSION_KEY: 'ar_shooter_session_id',
    USERNAME_KEY: 'ar_shooter_username',
    _telegramUser: null,
    
    /**
     * Инициализация - определяем пользователя
     */
    init() {
        // Инициализируем TelegramService если доступен
        if (typeof TelegramService !== 'undefined') {
            TelegramService.init();
            this._telegramUser = TelegramService.getUser();
        }
        
        // Если есть Telegram пользователь — используем его имя
        if (this._telegramUser) {
            console.log('👤 Telegram user:', this._telegramUser.username);
        }
    },
    
    /**
     * Проверка: используем ли Telegram аутентификацию
     */
    useTelegram() {
        return this._telegramUser && !this._telegramUser.isMock;
    },
    
    /**
     * Получить Telegram ID (или null)
     */
    getTelegramId() {
        return this._telegramUser?.telegramId || null;
    },
    
    /**
     * Получить initData для верификации
     */
    getInitData() {
        return this._telegramUser?.initData || null;
    },
    
    /**
     * Получить Session ID (fallback для не-Telegram)
     */
    getSessionId() {
        let sessionId = localStorage.getItem(this.SESSION_KEY);
        if (!sessionId) {
            sessionId = this.generateUUID();
            localStorage.setItem(this.SESSION_KEY, sessionId);
        }
        return sessionId;
    },
    
    /**
     * Получить имя пользователя
     */
    getUsername() {
        // Приоритет: Telegram username > сохранённое > пустое
        if (this._telegramUser?.username) {
            return this._telegramUser.username;
        }
        return localStorage.getItem(this.USERNAME_KEY) || '';
    },
    
    /**
     * Получить отображаемое имя
     */
    getDisplayName() {
        if (this._telegramUser) {
            return this._telegramUser.username || 
                   this._telegramUser.firstName || 
                   `Игрок #${this._telegramUser.telegramId}`;
        }
        return localStorage.getItem(this.USERNAME_KEY) || 'Гость';
    },
    
    /**
     * Сохранить имя (только для не-Telegram пользователей)
     */
    setUsername(username) {
        if (typeof username === 'string' && username.length >= 2) {
            const sanitized = username.trim().slice(0, 32).replace(/[<>]/g, '');
            localStorage.setItem(this.USERNAME_KEY, sanitized);
            return sanitized;
        }
        return null;
    },
    
    /**
     * Генерация UUID
     */
    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },
    
    /**
     * Получить данные для API запроса
     */
    getAuthData() {
        const telegramId = this.getTelegramId();
        if (telegramId) {
            return {
                telegramId: telegramId,
                initData: this.getInitData(),
            };
        }
        return {
            sessionId: this.getSessionId(),
        };
    }
};

// ============================================
// DEBUG LOGGER (визуальные логи на экране)
// ============================================
const DebugLogger = {
    _container: null,
    _logs: [],
    _maxLogs: 20,
    _enabled: true,
    
    init() {
        // Проверяем включены ли логи в конфиге
        if (typeof window.APP_CONFIG !== 'undefined' && window.APP_CONFIG.DEBUG_LOGS === false) {
            this._enabled = false;
            return;
        }
        
        // Создаём контейнер для логов
        this._container = document.createElement('div');
        this._container.id = 'debug-logs';
        this._container.innerHTML = `
            <div class="debug-header">
                <span>📋 Логи</span>
                <button id="debug-toggle-btn">−</button>
                <button id="debug-close-btn">×</button>
            </div>
            <div class="debug-content"></div>
        `;
        
        // Добавляем обработчики после создания элементов
        setTimeout(() => {
            document.getElementById('debug-toggle-btn')?.addEventListener('click', () => this.toggle());
            document.getElementById('debug-close-btn')?.addEventListener('click', () => this.close());
        }, 0);
        
        // Добавляем кнопку теста POST
        this._addTestButton();
        this._container.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            width: 300px;
            max-height: 40vh;
            background: rgba(0,0,0,0.95);
            color: #0f0;
            font-family: monospace;
            font-size: 10px;
            border-radius: 8px;
            z-index: 99999;
            overflow: hidden;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        `;
        
        const style = document.createElement('style');
        style.textContent = `
            #debug-logs .debug-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 6px 10px;
                background: #222;
                border-bottom: 1px solid #333;
                gap: 4px;
            }
            #debug-logs .debug-header span { flex: 1; }
            #debug-logs .debug-header button {
                background: #333;
                border: none;
                color: #fff;
                width: 22px;
                height: 22px;
                border-radius: 4px;
                cursor: pointer;
            }
            #debug-logs .debug-content {
                max-height: 35vh;
                overflow-y: auto;
                padding: 6px;
            }
            #debug-logs .debug-content.collapsed { display: none; }
            #debug-logs .log-entry {
                padding: 3px 0;
                border-bottom: 1px solid #222;
                word-break: break-all;
            }
            #debug-logs .log-error { color: #f55; }
            #debug-logs .log-success { color: #5f5; }
            #debug-logs .log-info { color: #5af; }
            #debug-logs .log-warn { color: #fa5; }
        `;
        document.head.appendChild(style);
        document.body.appendChild(this._container);
    },
    
    log(message, type = 'info') {
        if (!this._enabled) return;
        if (!this._container) this.init();
        if (!this._container) return;
        
        const time = new Date().toLocaleTimeString();
        this._logs.unshift({ time, message: String(message).substring(0, 200), type });
        if (this._logs.length > this._maxLogs) this._logs.pop();
        this._render();
    },
    
    error(msg) { this.log(msg, 'error'); },
    success(msg) { this.log(msg, 'success'); },
    warn(msg) { this.log(msg, 'warn'); },
    info(msg) { this.log(msg, 'info'); },
    
    _render() {
        const content = this._container?.querySelector('.debug-content');
        if (content) {
            content.innerHTML = this._logs.map(l => 
                `<div class="log-entry log-${l.type}">[${l.time}] ${l.message}</div>`
            ).join('');
        }
    },
    
    toggle() {
        const content = this._container?.querySelector('.debug-content');
        if (content) content.classList.toggle('collapsed');
    },
    
    close() {
        if (this._container) this._container.style.display = 'none';
    },
    
    _addTestButton() {
        const header = this._container?.querySelector('.debug-header');
        if (!header) return;
        
        const testBtn = document.createElement('button');
        testBtn.textContent = '🧪';
        testBtn.title = 'Test POST';
        testBtn.style.cssText = 'background:#355;font-size:12px;';
        testBtn.addEventListener('click', async () => {
            this.info('Testing POST...');
            try {
                const baseUrl = (typeof window.APP_CONFIG !== 'undefined' && window.APP_CONFIG.API_URL) 
                    ? window.APP_CONFIG.API_URL.replace('/api', '') 
                    : '';
                const response = await fetch(`${baseUrl}/api/test`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ test: 'data', time: Date.now() }),
                });
                const data = await response.json();
                this.success(`POST test: ${data.success ? 'OK!' : 'FAIL'}`);
            } catch (error) {
                this.error(`POST test: ${error.name}: ${error.message}`);
            }
        });
        header.insertBefore(testBtn, header.firstChild.nextSibling);
    }
};
window.DebugLogger = DebugLogger;

// ============================================
// API SERVICE (с поддержкой Telegram)
// ============================================
const ApiService = {
    // Базовый URL (из конфига или по умолчанию)
    getBaseUrl() {
        if (typeof window.APP_CONFIG !== 'undefined' && window.APP_CONFIG.API_URL) {
            return window.APP_CONFIG.API_URL;
        }
        return API_CONFIG.BASE_URL;
    },
    
    async request(endpoint, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT);
        
        const method = options.method || 'GET';
        DebugLogger.info(`${method} ${endpoint}`);
        
        try {
            const response = await fetch(`${this.getBaseUrl()}${endpoint}`, {
                ...options,
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
            });
            
            clearTimeout(timeoutId);
            
            const data = await response.json();
            
            if (!response.ok) {
                DebugLogger.error(`${method} ${endpoint} → ${response.status}: ${data.error || 'Error'}`);
                throw new Error(data.error || 'Ошибка сервера');
            }
            
            DebugLogger.success(`${method} ${endpoint} → OK`);
            return data;
        } catch (error) {
            clearTimeout(timeoutId);
            
            if (error.name === 'AbortError') {
                DebugLogger.warn(`${method} ${endpoint} → TIMEOUT`);
                return { success: false, error: 'Timeout' };
            }
            
            // Детальная информация об ошибке
            const errorInfo = `${error.name}: ${error.message}`;
            DebugLogger.error(`${method} ${endpoint} → ${errorInfo}`);
            
            // Если это TypeError, может быть проблема с сетью/CORS
            if (error instanceof TypeError) {
                DebugLogger.warn('Network/CORS error - check server');
            }
            
            console.error('API Error:', errorInfo);
            return { success: false, error: error.message };
        }
    },
    
    async submitScore(gameResult) {
        // Валидация на клиенте
        if (!gameResult || typeof gameResult.score !== 'number') {
            DebugLogger.error('Invalid game result!');
            return null;
        }
        
        // Получаем данные аутентификации (Telegram или Session)
        const authData = SessionManager.getAuthData();
        
        DebugLogger.info(`Saving: score=${gameResult.score}, tgId=${authData.telegramId || 'none'}`);
        
        const bodyData = {
            ...authData,  // telegramId + initData или sessionId
            score: Math.max(0, Math.floor(gameResult.score)),
            targetsHit: Math.max(0, Math.floor(gameResult.targetsHit)),
            shotsFired: Math.max(0, Math.floor(gameResult.shotsFired)),
            maxCombo: Math.max(1, Math.floor(gameResult.maxCombo)),
            durationMs: Math.max(1000, Math.floor(gameResult.durationMs)),
            gameMode: gameResult.gameMode || 'endless',
        };
        
        DebugLogger.info(`Data: hits=${bodyData.targetsHit}, shots=${bodyData.shotsFired}, combo=${bodyData.maxCombo}, dur=${bodyData.durationMs}ms`);
        
        const result = await this.request('/scores', {
            method: 'POST',
            body: JSON.stringify(bodyData),
        });
        
        if (result?.success) {
            DebugLogger.success(`Saved! Rank: #${result.data?.rank}`);
        } else {
            DebugLogger.error(`Save failed: ${result?.error || 'null response'}`);
        }
        
        return result;
    },
    
    async getLeaderboard(type = 'score', limit = 10) {
        return this.request(`/scores/leaderboard?type=${type}&limit=${limit}`);
    },
    
    async getUserStats() {
        const sessionId = SessionManager.getSessionId();
        return this.request(`/scores/user/${sessionId}`);
    },
    
    async updateUsername(username) {
        const sessionId = SessionManager.getSessionId();
        return this.request(`/scores/user/${sessionId}`, {
            method: 'PUT',
            body: JSON.stringify({ username }),
        });
    },
};

// ============================================
// SETTINGS
// ============================================
const settings = {
    showCamera: true,
    soundEnabled: true,
    showIndicators: true,
    sensitivity: 0.35,
};

// ============================================
// CONFIG (immutable)
// ============================================
const CONFIG = Object.freeze({
    DISC_COUNT: 6,
    DISC_SPEED: 0.012,
    DISC_SIZE: 0.5,
    AIM_ASSIST_RADIUS: 150,
    AIM_ASSIST_STRENGTH: 0.5,
    DETECTION_INTERVAL: 20,
    SHOOT_COOLDOWN: 350,
    HIT_RADIUS: 100,
    SMOOTHING: 0.35,
    JERK_SPEED_THRESHOLD: 0.35,
    BACK_THRESHOLD: 0.12,
    UP_THRESHOLD: 0.12,
    HORIZONTAL_MAX: 0.25,
    JERK_COOLDOWN: 450,
    GAME_DURATION: 60000, // 60 секунд
});

// Конфиг оружия
const WEAPONS = {
    pistol: {
        name: 'Пистолет',
        cooldown: 400,           // Перезарядка (мс)
        maxCombo: 10,            // Максимальное комбо
        damage: 100,             // Базовый урон
        hands: 1,                // Количество рук
        hitRadius: 100,          // Радиус попадания
        aimAssist: 0.5,          // Сила магнитного прицела
    },
    dual: {
        name: 'Двойные пистолеты',
        cooldown: 500,           // Чуть медленнее перезарядка
        maxCombo: 6,             // Меньше комбо (сложнее контролировать)
        damage: 100,             // Тот же урон
        hands: 2,                // Две руки
        hitRadius: 90,           // Чуть меньше радиус
        aimAssist: 0.4,          // Слабее магнит
    },
    shotgun: {
        name: 'Дробовик',
        cooldown: 800,           // Медленная перезарядка
        maxCombo: 5,             // Маленькое комбо
        damage: 200,             // Большой урон
        hands: 1,
        hitRadius: 180,          // Большой радиус поражения
        aimAssist: 0.3,
        locked: true,
    },
    sniper: {
        name: 'Снайперка',
        cooldown: 1200,          // Очень медленная
        maxCombo: 15,            // Большое комбо за точность
        damage: 300,             // Огромный урон
        hands: 1,
        hitRadius: 50,           // Маленький радиус — нужна точность
        aimAssist: 0.2,          // Почти нет помощи
        locked: true,
    }
};

// Получить текущий конфиг оружия
function getWeaponConfig() {
    return WEAPONS[gameState.selectedWeapon] || WEAPONS.pistol;
}

// ============================================
// HUB NAVIGATION
// ============================================
const hub = document.getElementById('hub');
const gameScreen = document.getElementById('game-screen');
const startGameBtn = document.getElementById('start-game-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings');
const exitGameBtn = document.getElementById('exit-game');
const toggleCamera = document.getElementById('toggle-camera');
const toggleSound = document.getElementById('toggle-sound');
const toggleIndicators = document.getElementById('toggle-indicators');
const sensitivitySlider = document.getElementById('sensitivity-slider');
const sensitivityValue = document.getElementById('sensitivity-value');
const cameraPip = document.getElementById('camera-pip');

startGameBtn.addEventListener('click', () => {
    hub.classList.remove('active');
    document.getElementById('profile-screen').classList.remove('active');
    document.getElementById('weapons-screen').classList.remove('active');
    document.getElementById('leaderboard-screen').classList.remove('active');
    document.getElementById('bottom-nav').style.display = 'none';
    gameScreen.classList.add('active');
    initGame();
});

settingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('active');
});

closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('active');
});

exitGameBtn.addEventListener('click', () => {
    // If game is in progress with shots fired, show end screen
    if (gameState.isPlaying && gameState.shotsFired > 0) {
        settingsModal.classList.remove('active');
        endGame();
    } else {
        // Otherwise just go to menu
        settingsModal.classList.remove('active');
        gameScreen.classList.remove('active');
        hub.classList.add('active');
        document.getElementById('bottom-nav').style.display = 'flex';
        gameState.isPlaying = false;
        
        // Исправление: корректно останавливаем камеру
        if (typeof stopCamera === 'function') {
            stopCamera();
        } else if (webcam.srcObject) {
            webcam.srcObject.getTracks().forEach(track => track.stop());
        }
        
        // Скрываем кнопку "Назад" в Telegram
        if (typeof TelegramService !== 'undefined') {
            TelegramService.hideBackButton();
        }
    }
});

toggleCamera.addEventListener('click', () => {
    settings.showCamera = !settings.showCamera;
    toggleCamera.classList.toggle('active', settings.showCamera);
    cameraPip.classList.toggle('hidden', !settings.showCamera);
});

toggleSound.addEventListener('click', () => {
    settings.soundEnabled = !settings.soundEnabled;
    toggleSound.classList.toggle('active', settings.soundEnabled);
});

toggleIndicators.addEventListener('click', () => {
    settings.showIndicators = !settings.showIndicators;
    toggleIndicators.classList.toggle('active', settings.showIndicators);
    gestureIndicator.style.display = settings.showIndicators ? 'flex' : 'none';
    shootHint.style.display = settings.showIndicators ? '' : 'none';
    speedMeter.style.display = settings.showIndicators ? '' : 'none';
});

sensitivitySlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    settings.sensitivity = val / 100;
    sensitivityValue.textContent = val + '%';
});

// ============================================
// RECOIL DETECTOR
// ============================================
class JerkDetector {
    constructor() {
        this.history = [];
        this.maxHistory = 10;
        this.lastJerkTime = 0;
    }

    addPosition(x, y) {
        const now = Date.now();
        this.history.push({ x, y, time: now });
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }
    }

    getMovement() {
        if (this.history.length < 4) return { dx: 0, dy: 0, speed: 0 };
        const len = this.history.length;
        const p1 = this.history[len - 4];
        const p2 = this.history[len - 1];
        const dt = (p2.time - p1.time) / 1000;
        if (dt <= 0) return { dx: 0, dy: 0, speed: 0 };
        const dx = (p2.x - p1.x) / dt;
        const dy = (p2.y - p1.y) / dt;
        return { dx, dy, speed: Math.sqrt(dx * dx + dy * dy) };
    }

    getCurrentSpeed() {
        return this.getMovement().speed;
    }

    checkJerk() {
        const now = Date.now();
        if (now - this.lastJerkTime < CONFIG.JERK_COOLDOWN) {
            return { detected: false, speed: 0, backSpeed: 0, upSpeed: 0 };
        }

        const mov = this.getMovement();
        const backSpeed = mov.dx;      // Положительный = назад
        const upSpeed = -mov.dy;       // Положительный = вверх
        const horizontalSpeed = Math.abs(mov.dx); // Горизонтальное движение
        
        const isMovingBack = backSpeed > CONFIG.BACK_THRESHOLD;
        const isMovingUp = upSpeed > CONFIG.UP_THRESHOLD;
        const isFastEnough = mov.speed > CONFIG.JERK_SPEED_THRESHOLD;
        
        // Отклонить если слишком много горизонтального движения без вертикального
        const isHorizontalOnly = horizontalSpeed > CONFIG.HORIZONTAL_MAX && upSpeed < CONFIG.UP_THRESHOLD * 0.5;
        
        // Рывок = быстро + назад + вверх + не чисто горизонтально
        const isRecoil = isFastEnough && isMovingBack && isMovingUp && !isHorizontalOnly;

        if (isRecoil) {
            this.lastJerkTime = now;
            return { detected: true, speed: mov.speed, backSpeed, upSpeed };
        }
        return { detected: false, speed: mov.speed, backSpeed, upSpeed };
    }

    clear() {
        this.history = [];
    }
}

// ============================================
// AUDIO
// ============================================
class AudioSystem {
    constructor() { this.ctx = null; }
    init() {
        if (this.ctx) return;
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
    }
    playShoot() {
        if (!this.ctx || !settings.soundEnabled) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.frequency.setValueAtTime(900, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.12);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.12);
    }
    playHit() {
        if (!this.ctx || !settings.soundEnabled) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.frequency.setValueAtTime(500, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(50, this.ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.2);
    }
    playMiss() {
        if (!this.ctx || !settings.soundEnabled) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.frequency.setValueAtTime(180, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(80, this.ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.2);
    }
}

// ============================================
// GAME STATE
// ============================================
const gameState = {
    // Core stats
    score: 0,
    combo: 1,
    maxCombo: 1,
    targetsHit: 0,
    shotsFired: 0,
    
    // Timing
    startTime: 0,
    lastHitTime: 0,
    lastShotTime: 0,
    
    // Aim (primary/left hand)
    aimPosition: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    smoothedAimPosition: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    
    // Aim (secondary/right hand for dual mode)
    aimPosition2: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    smoothedAimPosition2: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    
    // Gesture
    isPistolGesture: false,
    isPistolGesture2: false,  // Second hand
    handVisible: false,
    handVisible2: false,      // Second hand
    lockedTarget: null,
    lockedTarget2: null,      // Second hand
    lastHandTime: 0,
    lastHandTime2: 0,         // Second hand
    currentLandmarks: null,
    currentLandmarks2: null,  // Second hand
    
    // Game mode
    isPlaying: false,
    gameMode: 'endless',
    
    // Weapon
    selectedWeapon: 'pistol',  // 'pistol' или 'dual'
};

// Reset game state to initial values
function resetGameState() {
    gameState.score = 0;
    gameState.combo = 1;
    gameState.maxCombo = 1;
    gameState.targetsHit = 0;
    gameState.shotsFired = 0;
    gameState.startTime = Date.now();
    gameState.lastHitTime = 0;
    gameState.lastShotTime = 0;
    gameState.isPlaying = true;
    
    // Сброс состояния второй руки
    gameState.handVisible2 = false;
    gameState.isPistolGesture2 = false;
    gameState.currentLandmarks2 = null;
    gameState.lastHandTime2 = 0;
    gameState.aimPosition2 = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    gameState.smoothedAimPosition2 = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    
    // Сброс кулдаунов
    lastShotTime1 = 0;
    lastShotTime2 = 0;
    
    // Очистка детекторов
    jerkDetector.clear();
    jerkDetector2.clear();
    
    scoreDisplay.textContent = '0';
    comboDisplay.textContent = 'x1';
}

const jerkDetector = new JerkDetector();
const jerkDetector2 = new JerkDetector();  // Для второй руки
const audio = new AudioSystem();
let particles, discs = [];
let scene, camera, renderer, laserCtx;
let hands = null;
let gameInitialized = false;

// Dual crosshair elements
let crosshairLeft, crosshairRight;

// DOM
const loadingOverlay = document.getElementById('loading-overlay');
const loadingStatus = document.getElementById('loading-status');
const webcam = document.getElementById('webcam');
const trackingCanvas = document.getElementById('tracking-canvas');
let trackingCtx;
const gameCanvas = document.getElementById('game-canvas');
const laserCanvas = document.getElementById('laser-canvas');
const crosshair = document.getElementById('crosshair');
const crosshairRing = document.getElementById('crosshair-ring');
const crosshairDot = document.getElementById('crosshair-dot');
crosshairLeft = document.getElementById('crosshair-left');
crosshairRight = document.getElementById('crosshair-right');
const scoreDisplay = document.getElementById('score');
const comboDisplay = document.getElementById('combo');
const gestureIndicator = document.getElementById('gesture-indicator');
const gestureIcon = document.getElementById('gesture-icon');
const gestureText = document.getElementById('gesture-text');
const shootHint = document.getElementById('shoot-hint');
const speedMeter = document.getElementById('speed-meter');
const speedBar = document.getElementById('speed-bar');
const jerkFlash = document.getElementById('jerk-flash');

// ============================================
// HAND TRACKING
// ============================================
const HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]
];

function drawHandTracking(landmarks) {
    if (!trackingCtx) return;
    trackingCtx.clearRect(0, 0, trackingCanvas.width, trackingCanvas.height);
    if (!landmarks || landmarks.length === 0) return;

    const hand = landmarks[0];
    const w = trackingCanvas.width;
    const h = trackingCanvas.height;

    trackingCtx.strokeStyle = 'rgba(255,255,255,0.6)';
    trackingCtx.lineWidth = 1;
    for (const [start, end] of HAND_CONNECTIONS) {
        trackingCtx.beginPath();
        trackingCtx.moveTo(hand[start].x * w, hand[start].y * h);
        trackingCtx.lineTo(hand[end].x * w, hand[end].y * h);
        trackingCtx.stroke();
    }

    for (let i = 0; i < hand.length; i++) {
        const x = hand[i].x * w;
        const y = hand[i].y * h;
        trackingCtx.beginPath();
        trackingCtx.arc(x, y, i === 8 ? 6 : 3, 0, Math.PI * 2);
        trackingCtx.fillStyle = i === 8 ? '#ff3366' : 'rgba(255,255,255,0.8)';
        trackingCtx.fill();
    }
}

// ============================================
// DISC
// ============================================
class Disc {
    constructor(index) {
        this.index = index;
        this.radius = CONFIG.DISC_SIZE;
        this.velocity = new THREE.Vector3();
        this.createMesh();
        this.spawn();
    }
    
    createMesh() {
        this.hue = Math.random();
        this.group = new THREE.Group();
        
        const discGeo = new THREE.CylinderGeometry(this.radius, this.radius, 0.12, 48);
        const discMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color().setHSL(this.hue, 0.85, 0.5),
            metalness: 0.9, roughness: 0.15,
            emissive: new THREE.Color().setHSL(this.hue, 0.9, 0.35),
            emissiveIntensity: 0.5,
        });
        this.disc = new THREE.Mesh(discGeo, discMat);
        this.disc.rotation.x = Math.PI / 2;
        this.group.add(this.disc);
        
        const rimGeo = new THREE.TorusGeometry(this.radius, 0.04, 16, 48);
        const rimMat = new THREE.MeshStandardMaterial({ 
            color: new THREE.Color().setHSL(this.hue, 1, 0.7),
            metalness: 1, roughness: 0.1,
            emissive: new THREE.Color().setHSL(this.hue, 1, 0.5),
            emissiveIntensity: 0.8,
        });
        this.rim = new THREE.Mesh(rimGeo, rimMat);
        this.group.add(this.rim);
        
        const coreGeo = new THREE.CircleGeometry(this.radius * 0.4, 32);
        const coreMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(this.hue, 1, 0.8),
            transparent: true, opacity: 0.9, side: THREE.DoubleSide,
        });
        this.core = new THREE.Mesh(coreGeo, coreMat);
        this.core.position.z = 0.07;
        this.group.add(this.core);
        
        this.mesh = this.group;
        scene.add(this.group);
    }
    
    spawn() {
        const edge = Math.floor(Math.random() * 4);
        const spread = 5.5;
        switch(edge) {
            case 0: this.group.position.set((Math.random()-0.5)*spread*1.8, spread, 0); break;
            case 1: this.group.position.set((Math.random()-0.5)*spread*1.8, -spread, 0); break;
            case 2: this.group.position.set(-spread, (Math.random()-0.5)*spread*1.8, 0); break;
            case 3: this.group.position.set(spread, (Math.random()-0.5)*spread*1.8, 0); break;
        }
        const tx = (Math.random() - 0.5) * 2;
        const ty = (Math.random() - 0.5) * 2;
        const dir = new THREE.Vector3(tx - this.group.position.x, ty - this.group.position.y, 0).normalize();
        this.baseSpeed = CONFIG.DISC_SPEED * (0.7 + Math.random() * 0.5);
        this.velocity.copy(dir).multiplyScalar(this.baseSpeed);
        this.rotSpeed = (Math.random() - 0.5) * 0.12;
        this.wobblePhase = Math.random() * Math.PI * 2;
        this.pulsePhase = Math.random() * Math.PI * 2;
        this.alive = true;
    }
    
    update(allDiscs) {
        if (!this.alive) return;
        this.group.position.add(this.velocity);
        
        for (const other of allDiscs) {
            if (other === this || !other.alive) continue;
            const dx = other.group.position.x - this.group.position.x;
            const dy = other.group.position.y - this.group.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minDist = this.radius + other.radius + 0.3;
            
            if (dist < minDist && dist > 0.01) {
                const overlap = minDist - dist;
                const nx = dx / dist, ny = dy / dist;
                this.group.position.x -= nx * overlap * 0.3;
                this.group.position.y -= ny * overlap * 0.3;
                other.group.position.x += nx * overlap * 0.3;
                other.group.position.y += ny * overlap * 0.3;
            }
        }
        
        const currentSpeed = this.velocity.length();
        if (currentSpeed > 0.001) {
            const speedDiff = this.baseSpeed - currentSpeed;
            this.velocity.normalize().multiplyScalar(currentSpeed + speedDiff * 0.02);
        }
        
        this.wobblePhase += 0.03;
        this.group.rotation.x = Math.sin(this.wobblePhase) * 0.15;
        this.disc.rotation.z += this.rotSpeed;
        this.pulsePhase += 0.05;
        this.core.material.opacity = 0.7 + Math.sin(this.pulsePhase) * 0.3;
        
        if (Math.abs(this.group.position.x) > 7 || Math.abs(this.group.position.y) > 7) {
            this.spawn();
        }
    }
    
    getScreenPos() {
        const v = this.group.position.clone();
        v.project(camera);
        return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
    }
    
    respawn() {
        this.hue = Math.random();
        this.disc.material.color.setHSL(this.hue, 0.85, 0.5);
        this.disc.material.emissive.setHSL(this.hue, 0.9, 0.35);
        this.rim.material.color.setHSL(this.hue, 1, 0.7);
        this.rim.material.emissive.setHSL(this.hue, 1, 0.5);
        this.core.material.color.setHSL(this.hue, 1, 0.8);
        this.spawn();
    }
}

// ============================================
// PARTICLES
// ============================================
class ParticleSystem {
    constructor() { this.particles = []; }
    emit(x, y, z, count = 25, hue = null) {
        for (let i = 0; i < count; i++) {
            const size = 0.03 + Math.random() * 0.03;
            const geo = new THREE.SphereGeometry(size, 6, 6);
            const pHue = hue !== null ? hue : Math.random();
            const mat = new THREE.MeshBasicMaterial({ 
                color: new THREE.Color().setHSL(pHue, 1, 0.5 + Math.random() * 0.3),
                transparent: true, opacity: 1,
            });
            const p = new THREE.Mesh(geo, mat);
            p.position.set(x, y, z);
            const angle = Math.random() * Math.PI * 2;
            const speed = 0.15 + Math.random() * 0.15;
            p.velocity = new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed + 0.1, (Math.random() - 0.5) * 0.1);
            p.life = 1;
            p.decay = 0.02 + Math.random() * 0.02;
            scene.add(p);
            this.particles.push(p);
        }
    }
    update() {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.position.add(p.velocity);
            p.velocity.y -= 0.008;
            p.life -= p.decay;
            p.material.opacity = p.life;
            p.scale.setScalar(p.life);
            if (p.life <= 0) {
                scene.remove(p);
                p.geometry.dispose();
                p.material.dispose();
                this.particles.splice(i, 1);
            }
        }
    }
}

// ============================================
// GAME FUNCTIONS
// ============================================
function detectPistolGesture(landmarks) {
    if (!landmarks || landmarks.length === 0) return false;
    const h = landmarks[0];
    const indexExtended = h[8].y < h[6].y + 0.02;
    const middleCurled = h[12].y > h[10].y - 0.08;
    const ringCurled = h[16].y > h[14].y - 0.08;
    const pinkyCurled = h[20].y > h[18].y - 0.08;
    return indexExtended && [middleCurled, ringCurled, pinkyCurled].filter(x=>x).length >= 1;
}

function applyAimAssist(rawX, rawY, handIndex = 0) {
    const weapon = getWeaponConfig();
    let ax = rawX, ay = rawY;
    let closest = CONFIG.AIM_ASSIST_RADIUS;
    let locked = null;
    
    for (const d of discs) {
        if (!d.alive) continue;
        const sp = d.getScreenPos();
        const dx = sp.x - rawX, dy = sp.y - rawY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < closest) {
            closest = dist;
            locked = d;
            // Сила магнита зависит от оружия
            const pull = weapon.aimAssist * (1 - dist/CONFIG.AIM_ASSIST_RADIUS);
            ax = rawX + dx*pull;
            ay = rawY + dy*pull;
        }
    }
    // Сохраняем locked target для соответствующей руки
    if (handIndex === 0) {
    gameState.lockedTarget = locked;
    } else {
        gameState.lockedTarget2 = locked;
    }
    return { x: ax, y: ay };
}

function showVFX(text, x, y, isHit) {
    const el = document.createElement('div');
    el.className = `vfx-text ${isHit ? 'vfx-hit' : 'vfx-miss'}`;
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 700);
}

// Отдельные кулдауны для каждой руки
let lastShotTime1 = 0, lastShotTime2 = 0;

function shoot(handIndex = 0) {
    const now = Date.now();
    const weapon = getWeaponConfig();
    
    // Кулдаун для каждой руки отдельно (с учётом оружия)
    if (handIndex === 0) {
        if (now - lastShotTime1 < weapon.cooldown) return;
        lastShotTime1 = now;
    } else {
        if (now - lastShotTime2 < weapon.cooldown) return;
        lastShotTime2 = now;
    }
    
    if (!gameState.isPlaying) return;
    
    gameState.lastShotTime = now;
    gameState.shotsFired++;

    jerkFlash.classList.add('active');
    setTimeout(() => jerkFlash.classList.remove('active'), 100);

    audio.playShoot();

    let hit = false;
    // Выбираем позицию прицела в зависимости от руки
    const ax = handIndex === 0 ? gameState.aimPosition.x : gameState.aimPosition2.x;
    const ay = handIndex === 0 ? gameState.aimPosition.y : gameState.aimPosition2.y;

    for (const d of discs) {
        if (!d.alive) continue;
        const sp = d.getScreenPos();
        const dist = Math.sqrt((sp.x-ax)**2 + (sp.y-ay)**2);
        
        // Радиус попадания зависит от оружия
        if (dist < weapon.hitRadius) {
            hit = true;
            gameState.targetsHit++;
            particles.emit(d.group.position.x, d.group.position.y, d.group.position.z, 30, d.hue);
            
            // Урон и очки зависят от оружия
            const points = weapon.damage * gameState.combo;
            gameState.score += points;
            
            if (now - gameState.lastHitTime < 2000) {
                // Максимальное комбо зависит от оружия
                gameState.combo = Math.min(gameState.combo + 1, weapon.maxCombo);
            }
            gameState.maxCombo = Math.max(gameState.maxCombo, gameState.combo);
            gameState.lastHitTime = now;
            d.respawn();
            showVFX(`+${points}`, sp.x, sp.y, true);
            audio.playHit();
            break;
        }
    }

    if (!hit) {
        gameState.combo = 1;
        showVFX('МИМО', ax, ay, false);
        audio.playMiss();
    }

    scoreDisplay.textContent = gameState.score;
    comboDisplay.textContent = `x${gameState.combo}`;
}

function drawLaser() {
    laserCtx.clearRect(0, 0, laserCanvas.width, laserCanvas.height);
    const isDualMode = gameState.selectedWeapon === 'dual';

    // Первый лазер (левая/главная рука)
    if (gameState.handVisible && gameState.isPistolGesture) {
    const sx = gameState.smoothedAimPosition.x, sy = gameState.smoothedAimPosition.y + 50;
    const ex = gameState.aimPosition.x, ey = gameState.aimPosition.y;
        const color = isDualMode ? 'rgba(255,68,68,' : 'rgba(255,255,255,';

        laserCtx.strokeStyle = gameState.lockedTarget ? 'rgba(0,255,204,0.2)' : color + '0.1)';
    laserCtx.lineWidth = 10;
    laserCtx.lineCap = 'round';
    laserCtx.beginPath();
    laserCtx.moveTo(sx, sy);
    laserCtx.lineTo(ex, ey);
    laserCtx.stroke();

        laserCtx.strokeStyle = gameState.lockedTarget ? '#00ffcc' : (isDualMode ? '#ff4444' : 'rgba(255,255,255,0.8)');
    laserCtx.lineWidth = 2;
    laserCtx.beginPath();
    laserCtx.moveTo(sx, sy);
    laserCtx.lineTo(ex, ey);
    laserCtx.stroke();
    }
    
    // Второй лазер (правая рука) — только в dual mode
    if (isDualMode && gameState.handVisible2 && gameState.isPistolGesture2) {
        const sx2 = gameState.smoothedAimPosition2.x, sy2 = gameState.smoothedAimPosition2.y + 50;
        const ex2 = gameState.aimPosition2.x, ey2 = gameState.aimPosition2.y;

        laserCtx.strokeStyle = gameState.lockedTarget2 ? 'rgba(0,255,204,0.2)' : 'rgba(68,68,255,0.1)';
        laserCtx.lineWidth = 10;
        laserCtx.lineCap = 'round';
        laserCtx.beginPath();
        laserCtx.moveTo(sx2, sy2);
        laserCtx.lineTo(ex2, ey2);
        laserCtx.stroke();

        laserCtx.strokeStyle = gameState.lockedTarget2 ? '#00ffcc' : '#4444ff';
        laserCtx.lineWidth = 2;
        laserCtx.beginPath();
        laserCtx.moveTo(sx2, sy2);
        laserCtx.lineTo(ex2, ey2);
        laserCtx.stroke();
    }
}

function gameLoop() {
    if (!gameScreen.classList.contains('active')) return;
    requestAnimationFrame(gameLoop);

    for (const d of discs) d.update(discs);
    particles.update();

    const smoothing = settings.sensitivity;
    const isDualMode = gameState.selectedWeapon === 'dual';
    
    // Сглаживание первой руки
    gameState.smoothedAimPosition.x += (gameState.aimPosition.x - gameState.smoothedAimPosition.x) * smoothing;
    gameState.smoothedAimPosition.y += (gameState.aimPosition.y - gameState.smoothedAimPosition.y) * smoothing;
    
    // Сглаживание второй руки (dual mode)
    if (isDualMode) {
        gameState.smoothedAimPosition2.x += (gameState.aimPosition2.x - gameState.smoothedAimPosition2.x) * smoothing;
        gameState.smoothedAimPosition2.y += (gameState.aimPosition2.y - gameState.smoothedAimPosition2.y) * smoothing;
    }

    const now = Date.now();
    const handRecent = now - gameState.lastHandTime < 400;
    const handRecent2 = isDualMode && (now - gameState.lastHandTime2 < 400);

    // Первый прицел
    if (gameState.handVisible || handRecent) {
        if (isDualMode) {
            // В dual режиме используем цветные прицелы
            crosshair.style.display = 'none';
            crosshairLeft.classList.add('visible');
            crosshairLeft.style.left = gameState.smoothedAimPosition.x + 'px';
            crosshairLeft.style.top = gameState.smoothedAimPosition.y + 'px';
            crosshairLeft.style.opacity = gameState.isPistolGesture ? '1' : '0.4';
        } else {
            // Обычный режим
        crosshair.style.display = 'block';
        crosshair.style.left = gameState.smoothedAimPosition.x + 'px';
        crosshair.style.top = gameState.smoothedAimPosition.y + 'px';
        crosshair.style.opacity = gameState.isPistolGesture ? '1' : '0.4';
            crosshairLeft.classList.remove('visible');
        }
        
        if (gameState.lockedTarget) {
            crosshairRing.classList.add('locked');
            crosshairDot.classList.add('locked');
        } else {
            crosshairRing.classList.remove('locked');
            crosshairDot.classList.remove('locked');
        }
        
        if (gameState.isPistolGesture && settings.showIndicators) {
            shootHint.classList.add('visible');
            speedMeter.classList.add('visible');
            const speed = jerkDetector.getCurrentSpeed();
            speedBar.style.width = Math.min(speed / (CONFIG.JERK_SPEED_THRESHOLD * 1.25) * 100, 100) + '%';
        } else {
            shootHint.classList.remove('visible');
            speedMeter.classList.remove('visible');
        }
    } else {
        crosshair.style.display = 'none';
        crosshairLeft.classList.remove('visible');
        shootHint.classList.remove('visible');
        speedMeter.classList.remove('visible');
    }

    // Второй прицел (только в dual mode)
    if (isDualMode) {
        if (gameState.handVisible2 || handRecent2) {
            crosshairRight.classList.add('visible');
            crosshairRight.style.left = gameState.smoothedAimPosition2.x + 'px';
            crosshairRight.style.top = gameState.smoothedAimPosition2.y + 'px';
            crosshairRight.style.opacity = gameState.isPistolGesture2 ? '1' : '0.4';
        } else {
            crosshairRight.classList.remove('visible');
        }
    } else {
        crosshairRight.classList.remove('visible');
    }

    // Отрисовка трекинга рук
    if (settings.showCamera) {
        const allLandmarks = [];
        if (gameState.currentLandmarks) allLandmarks.push(...gameState.currentLandmarks);
        if (isDualMode && gameState.currentLandmarks2) allLandmarks.push(...gameState.currentLandmarks2);
        if (allLandmarks.length > 0) drawHandTracking(allLandmarks);
    }

    drawLaser();
    renderer.render(scene, camera);

    if (now - gameState.lastHitTime > 3000) {
        gameState.combo = 1;
        comboDisplay.textContent = 'x1';
    }
}

let lastDetection = 0;
async function processFrame() {
    if (!gameScreen.classList.contains('active')) return;
    const now = Date.now();
    if (hands && now - lastDetection >= CONFIG.DETECTION_INTERVAL) {
        lastDetection = now;
        try { await hands.send({ image: webcam }); } catch(e) {}
    }
    requestAnimationFrame(processFrame);
}

// ============================================
// INIT GAME
// ============================================
async function initGame() {
    console.log('🎮 initGame вызван, gameInitialized =', gameInitialized);
    
    // Показываем загрузочный экран
    loadingOverlay.classList.remove('hidden');
    
    // Reset game state on every start
    resetGameState();
    
    // Если игра уже инициализирована - просто запускаем
    if (gameInitialized && hands && webcam.srcObject) {
        console.log('♻️ Быстрый перезапуск');
        loadingOverlay.classList.add('hidden');
        gameLoop();
        processFrame();
        return;
    }
    
    // Полная инициализация
    console.log('🔄 Полная инициализация игры...');
    gameInitialized = false; // На всякий случай

    try {
        loadingStatus.textContent = 'Запрос камеры...';

        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        webcam.srcObject = stream;
        await webcam.play();

        trackingCanvas.width = webcam.videoWidth || 640;
        trackingCanvas.height = webcam.videoHeight || 480;
        trackingCtx = trackingCanvas.getContext('2d');

        loadingStatus.textContent = 'Загрузка модели...';

        // Three.js
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.z = 5;

        renderer = new THREE.WebGLRenderer({ canvas: gameCanvas, alpha: true, antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        laserCtx = laserCanvas.getContext('2d');
        laserCanvas.width = window.innerWidth;
        laserCanvas.height = window.innerHeight;

        scene.add(new THREE.AmbientLight(0xffffff, 0.4));
        const mainLight = new THREE.PointLight(0xffffff, 1.2, 100);
        mainLight.position.set(0, 0, 8);
        scene.add(mainLight);

        particles = new ParticleSystem();

        // MediaPipe - отслеживаем 2 руки для режима двойных пистолетов
        hands = new Hands({
            locateFile: (file) => `https://unpkg.com/@mediapipe/hands@0.4.1646424915/${file}`
        });
        hands.setOptions({
            maxNumHands: 2,  // Всегда 2 руки для поддержки dual режима
            modelComplexity: 1,
            minDetectionConfidence: 0.4,
            minTrackingConfidence: 0.3
        });
        
        // Ждём полной инициализации модели (таймаут 60 сек)
        loadingStatus.textContent = 'Загрузка модели ИИ...';
        console.log('⏳ Инициализация MediaPipe Hands...');
        
        const initPromise = hands.initialize();
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Таймаут загрузки модели (60с). Попробуй перезагрузить.')), 60000)
        );
        await Promise.race([initPromise, timeoutPromise]);
        console.log('✅ MediaPipe Hands инициализирован!');

        hands.onResults((results) => {
            try {
                const isDualMode = gameState.selectedWeapon === 'dual';
                const numHands = results.multiHandLandmarks?.length || 0;
                
                // Обработка первой руки
                if (numHands > 0) {
                    gameState.handVisible = true;
                    gameState.lastHandTime = Date.now();
                    gameState.currentLandmarks = results.multiHandLandmarks;
                    gameState.isPistolGesture = detectPistolGesture([results.multiHandLandmarks[0]]);

                    const h = results.multiHandLandmarks[0];
                    const indexTip = h[8];
                    jerkDetector.addPosition(indexTip.x, indexTip.y);

                    const screenX = (1 - indexTip.x) * window.innerWidth;
                    const screenY = indexTip.y * window.innerHeight;
                    const assisted = applyAimAssist(screenX, screenY);
                    gameState.aimPosition = assisted;

                    if (gameState.isPistolGesture) {
                        const recoil = jerkDetector.checkJerk();
                        if (recoil.detected) shoot(0); // Индекс руки
                    }
                } else {
                    gameState.handVisible = false;
                    gameState.isPistolGesture = false;
                    gameState.currentLandmarks = null;
                    jerkDetector.clear();
                }
                
                // Обработка второй руки (только в dual режиме)
                if (isDualMode && numHands > 1) {
                    gameState.handVisible2 = true;
                    gameState.lastHandTime2 = Date.now();
                    gameState.currentLandmarks2 = [results.multiHandLandmarks[1]];
                    gameState.isPistolGesture2 = detectPistolGesture([results.multiHandLandmarks[1]]);

                    const h2 = results.multiHandLandmarks[1];
                    const indexTip2 = h2[8];
                    jerkDetector2.addPosition(indexTip2.x, indexTip2.y);

                    const screenX2 = (1 - indexTip2.x) * window.innerWidth;
                    const screenY2 = indexTip2.y * window.innerHeight;
                    const assisted2 = applyAimAssist(screenX2, screenY2, 1);
                    gameState.aimPosition2 = assisted2;

                    if (gameState.isPistolGesture2) {
                        const recoil2 = jerkDetector2.checkJerk();
                        if (recoil2.detected) shoot(1); // Вторая рука
                    }
                } else if (isDualMode) {
                    gameState.handVisible2 = false;
                    gameState.isPistolGesture2 = false;
                    gameState.currentLandmarks2 = null;
                    jerkDetector2.clear();
                }

                // UI индикатор
                if (gameState.isPistolGesture || (isDualMode && gameState.isPistolGesture2)) {
                    gestureIcon.textContent = isDualMode ? '🔫🔫' : '🔫';
                        gestureText.textContent = 'Целься';
                } else if (gameState.handVisible) {
                        gestureIcon.textContent = '👆';
                        gestureText.textContent = 'Пистолет';
                } else {
                    gestureIcon.textContent = '✋';
                    gestureText.textContent = isDualMode ? 'Покажи руки' : 'Покажи руку';
                    if (trackingCtx) trackingCtx.clearRect(0, 0, trackingCanvas.width, trackingCanvas.height);
                }
            } catch(e) { console.error('Hand tracking error:', e); }
        });

        loadingStatus.textContent = 'Первый кадр...';
        console.log('⏳ Отправляем первый кадр...');

        // Пробуем отправить первый кадр (с повторными попытками)
        let firstFrameSent = false;
        for (let i = 0; i < 50 && !firstFrameSent; i++) {
            try {
                await hands.send({ image: webcam });
                firstFrameSent = true;
                console.log('✅ Первый кадр обработан!');
            } catch(e) {
                console.log(`Попытка ${i + 1}...`);
                await new Promise(r => setTimeout(r, 200));
            }
        }
        
        if (!firstFrameSent) {
            throw new Error('Не удалось запустить распознавание. Проверь камеру.');
        }

        for (let i = 0; i < CONFIG.DISC_COUNT; i++) discs.push(new Disc(i));

        gameInitialized = true;
        loadingOverlay.classList.add('hidden');

        document.addEventListener('click', () => audio.init(), { once: true });
        audio.init();

        gameLoop();
        processFrame();

    } catch (e) {
        console.error('❌ Ошибка инициализации:', e);
        loadingStatus.textContent = `Ошибка: ${e.message}`;
        loadingStatus.style.color = '#ff6666';
        
        // Показываем кнопку "Попробовать снова"
        const retryBtn = document.createElement('button');
        retryBtn.textContent = 'Попробовать снова';
        retryBtn.style.cssText = 'margin-top: 20px; padding: 12px 24px; border-radius: 8px; border: none; background: #fff; color: #000; cursor: pointer; font-size: 14px;';
        retryBtn.onclick = () => location.reload();
        loadingOverlay.appendChild(retryBtn);
    }
}

window.addEventListener('resize', () => {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    laserCanvas.width = window.innerWidth;
    laserCanvas.height = window.innerHeight;
});

// ============================================
// LEADERBOARD
// ============================================
const leaderboardBody = document.getElementById('leaderboard-body');
const leaderboardLoading = document.getElementById('leaderboard-loading');
const leaderboardEmpty = document.getElementById('leaderboard-empty');
const leaderboardTabs = document.querySelectorAll('.leaderboard-tab');

let currentLeaderboardType = 'score';

async function loadLeaderboard(type = 'score') {
    currentLeaderboardType = type;
    leaderboardBody.innerHTML = '';
    leaderboardLoading.style.display = 'block';
    leaderboardEmpty.style.display = 'none';
    
    // Update active tab
    leaderboardTabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.type === type);
    });
    
    const result = await ApiService.getLeaderboard(type, 10);
    
    leaderboardLoading.style.display = 'none';
    
    if (!result || !result.data || result.data.leaders.length === 0) {
        leaderboardEmpty.style.display = 'block';
        return;
    }
    
    const leaders = result.data.leaders;
    
    leaderboardBody.innerHTML = leaders.map((leader, index) => {
        const rankClass = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : '';
        const avatar = leader.username ? leader.username[0].toUpperCase() : '?';
        
        let mainValue;
        switch (type) {
            case 'hits':
                mainValue = leader.targetsHit;
                break;
            case 'accuracy':
                mainValue = leader.accuracy + '%';
                break;
            default:
                mainValue = leader.score;
        }
        
        return `
            <div class="leaderboard-row">
                <div class="leaderboard-rank ${rankClass}">${leader.rank}</div>
                <div class="leaderboard-player">
                    <div class="leaderboard-avatar">${avatar}</div>
                    <div class="leaderboard-name">${escapeHtml(leader.username)}</div>
                </div>
                <div class="leaderboard-score">${mainValue}</div>
                <div class="leaderboard-hits">${leader.targetsHit} 🎯</div>
            </div>
        `;
    }).join('');
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Tab click handlers
leaderboardTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        loadLeaderboard(tab.dataset.type);
    });
});

// ============================================
// GAME END
// ============================================
const gameEndOverlay = document.getElementById('game-end-overlay');
const endScore = document.getElementById('end-score');
const endHits = document.getElementById('end-hits');
const endAccuracy = document.getElementById('end-accuracy');
const endCombo = document.getElementById('end-combo');
const endRankSection = document.getElementById('end-rank-section');
const endRank = document.getElementById('end-rank');
const endSubtitle = document.getElementById('end-subtitle');
const usernameInput = document.getElementById('username-input');
const btnPlayAgain = document.getElementById('btn-play-again');
const btnToMenu = document.getElementById('btn-to-menu');

async function endGame() {
    if (!gameState.isPlaying) return;
    gameState.isPlaying = false;
    
    const durationMs = Date.now() - gameState.startTime;
    const accuracy = gameState.shotsFired > 0 
        ? Math.round((gameState.targetsHit / gameState.shotsFired) * 100) 
        : 0;
    
    // Update UI
    endScore.textContent = gameState.score;
    endHits.textContent = gameState.targetsHit;
    endAccuracy.textContent = accuracy + '%';
    endCombo.textContent = 'x' + gameState.maxCombo;
    
    // Set subtitle based on performance
    if (accuracy >= 80) {
        endSubtitle.textContent = 'Невероятная точность! 🎯';
    } else if (gameState.score >= 2000) {
        endSubtitle.textContent = 'Отличный результат! 🔥';
    } else if (gameState.targetsHit >= 20) {
        endSubtitle.textContent = 'Хорошая работа! 💪';
    } else {
        endSubtitle.textContent = 'Попробуй ещё раз! 🎮';
    }
    
    // Set username from storage
    usernameInput.value = SessionManager.getUsername();
    
    // Show overlay
    gameEndOverlay.classList.add('active');
    
    // Submit score to server
    const gameResult = {
        score: gameState.score,
        targetsHit: gameState.targetsHit,
        shotsFired: gameState.shotsFired,
        maxCombo: gameState.maxCombo,
        durationMs: Math.max(1000, durationMs),
        gameMode: gameState.gameMode,
    };
    
    const result = await ApiService.submitScore(gameResult);
    
    if (result && result.data) {
        endRankSection.style.display = 'block';
        endRank.textContent = '#' + result.data.rank;
    } else {
        endRankSection.style.display = 'none';
    }
}

// Play again button
btnPlayAgain.addEventListener('click', async () => {
    // Save username if provided
    const username = usernameInput.value.trim();
    if (username.length >= 2) {
        SessionManager.setUsername(username);
        await ApiService.updateUsername(username);
    }
    
    gameEndOverlay.classList.remove('active');
    resetGameState();
});

// Back to menu button
btnToMenu.addEventListener('click', async () => {
    // Save username if provided
    const username = usernameInput.value.trim();
    if (username.length >= 2) {
        SessionManager.setUsername(username);
        await ApiService.updateUsername(username);
    }
    
    gameEndOverlay.classList.remove('active');
    gameScreen.classList.remove('active');
    hub.classList.add('active');
    document.getElementById('bottom-nav').style.display = 'flex';
    
    // Refresh leaderboard
    loadLeaderboard(currentLeaderboardType);
    
    // Корректно останавливаем камеру и сбрасываем состояние
    stopCamera();
});

// Keyboard shortcut to end game (Escape)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && gameScreen.classList.contains('active')) {
        if (settingsModal.classList.contains('active')) {
            settingsModal.classList.remove('active');
        } else if (!gameEndOverlay.classList.contains('active')) {
            settingsModal.classList.add('active');
        }
    }
});

// ============================================
// INITIALIZE
// ============================================
// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    // 0. Инициализируем визуальные логи
    DebugLogger.init();
    DebugLogger.info('App loaded');
    
    // 1. Инициализируем SessionManager (и Telegram если доступен)
    SessionManager.init();
    DebugLogger.info(`User: ${SessionManager.getDisplayName()}`);
    
    // 2. Загружаем рейтинг
    loadLeaderboard('score');
    
    // 3. Заполняем имя пользователя
    const displayName = SessionManager.getDisplayName();
    if (displayName && displayName !== 'Гость') {
        usernameInput.value = displayName;
        // Если Telegram пользователь — делаем поле readonly
        if (SessionManager.useTelegram()) {
            usernameInput.readOnly = true;
            usernameInput.style.opacity = '0.7';
            usernameInput.placeholder = 'Telegram: @' + displayName;
        }
    }
    
    // 4. Показываем приветствие для Telegram пользователей
    if (SessionManager.getTelegramId()) {
        console.log('👋 Привет, ' + displayName + '!');
    }
    
    // 5. Инициализация навигации
    initBottomNav();
    
    // 6. Загружаем профиль
    loadProfileData();
});

// ============================================
// BOTTOM NAVIGATION
// ============================================
function initBottomNav() {
    const bottomNav = document.getElementById('bottom-nav');
    const hubScreen = document.getElementById('hub');
    const profileScreen = document.getElementById('profile-screen');
    const weaponsScreen = document.getElementById('weapons-screen');
    const leaderboardScreen = document.getElementById('leaderboard-screen');
    const navItems = bottomNav.querySelectorAll('.nav-item');
    
    // По умолчанию показываем хаб
    hubScreen.classList.add('active');
    bottomNav.style.display = 'flex';
    
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetScreen = item.dataset.screen;
            
            // Убираем active у всех
            navItems.forEach(i => i.classList.remove('active'));
            hubScreen.classList.remove('active');
            profileScreen.classList.remove('active');
            weaponsScreen.classList.remove('active');
            leaderboardScreen.classList.remove('active');
            
            // Добавляем active выбранному
            item.classList.add('active');
            
            if (targetScreen === 'hub') {
                hubScreen.classList.add('active');
            } else if (targetScreen === 'profile') {
                profileScreen.classList.add('active');
                loadProfileData();
            } else if (targetScreen === 'weapons') {
                weaponsScreen.classList.add('active');
            } else if (targetScreen === 'leaderboard') {
                leaderboardScreen.classList.add('active');
                loadLeaderboard(currentLeaderboardType);
            }
        });
    });
    
    // Инициализация выбора оружия
    initWeaponSelection();
}

// ============================================
// WEAPON SELECTION
// ============================================
function initWeaponSelection() {
    const weaponCards = document.querySelectorAll('.weapon-card:not(.locked)');
    
    weaponCards.forEach(card => {
        card.addEventListener('click', () => {
            // Убираем selected у всех
            document.querySelectorAll('.weapon-card').forEach(c => c.classList.remove('selected'));
            
            // Добавляем selected выбранному
            card.classList.add('selected');
            
            // Сохраняем выбор
            const weapon = card.dataset.weapon;
            gameState.selectedWeapon = weapon;
            localStorage.setItem('ar_shooter_weapon', weapon);
            
            console.log('🔫 Выбрано оружие:', weapon);
        });
    });
    
    // Восстанавливаем сохранённый выбор
    const savedWeapon = localStorage.getItem('ar_shooter_weapon') || 'pistol';
    gameState.selectedWeapon = savedWeapon;
    
    const savedCard = document.querySelector(`.weapon-card[data-weapon="${savedWeapon}"]`);
    if (savedCard && !savedCard.classList.contains('locked')) {
        document.querySelectorAll('.weapon-card').forEach(c => c.classList.remove('selected'));
        savedCard.classList.add('selected');
    }
}

// ============================================
// PROFILE DATA
// ============================================
async function loadProfileData() {
    const displayNameEl = document.getElementById('profile-display-name');
    const usernameEl = document.getElementById('profile-username');
    const avatarEl = document.getElementById('profile-avatar');
    const totalScoreEl = document.getElementById('profile-total-score');
    const gamesEl = document.getElementById('profile-games');
    const rankEl = document.getElementById('profile-rank');
    const historyEl = document.getElementById('profile-history');
    const emptyEl = document.getElementById('profile-empty');
    
    // Показываем имя
    const displayName = SessionManager.getDisplayName();
    displayNameEl.textContent = displayName;
    
    // Username/info и аватар
    if (SessionManager.getTelegramId()) {
        usernameEl.textContent = '@' + SessionManager.getUsername();
        // Показываем первую букву имени
        avatarEl.innerHTML = `<span style="font-size: 32px; font-weight: 600;">${displayName.charAt(0).toUpperCase()}</span>`;
    } else {
        usernameEl.textContent = 'Гость';
        // Показываем иконку для гостя
        avatarEl.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>`;
    }
    
    // Загружаем статистику с сервера
    try {
        const telegramId = SessionManager.getTelegramId();
        const sessionId = SessionManager.getSessionId();
        
        let response;
        if (telegramId) {
            console.log('📊 Загружаем профиль для telegramId:', telegramId);
            response = await ApiService.request(`/scores/user/telegram/${telegramId}`);
        } else {
            console.log('📊 Загружаем профиль для sessionId:', sessionId);
            response = await ApiService.request(`/scores/user/${sessionId}`);
        }
        console.log('📊 Ответ сервера:', response);
        
        if (response.success && response.data) {
            const data = response.data;
            const stats = data.stats || {};
            const games = data.recentGames || [];
            
            // Обновляем статы
            totalScoreEl.textContent = (stats.bestScore || 0).toLocaleString();
            gamesEl.textContent = stats.totalGames || 0;
            rankEl.textContent = data.rank ? '#' + data.rank : '—';
            
            // История игр (последние 5)
            if (games.length > 0) {
                emptyEl.style.display = 'none';
                historyEl.innerHTML = games.map(game => {
                    const date = new Date(game.playedAt);
                    const dateStr = date.toLocaleDateString('ru-RU', { 
                        day: 'numeric', 
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    const accuracy = Math.round(game.accuracy || 0);
                    
                    return `
                        <div class="history-item">
                            <div class="history-left">
                                <div class="history-icon">
                                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                                        <circle cx="12" cy="12" r="10"/>
                                        <circle cx="12" cy="12" r="3"/>
                                        <line x1="12" y1="2" x2="12" y2="5"/>
                                        <line x1="12" y1="19" x2="12" y2="22"/>
                                        <line x1="2" y1="12" x2="5" y2="12"/>
                                        <line x1="19" y1="12" x2="22" y2="12"/>
                                    </svg>
                                </div>
                                <div class="history-info">
                                    <div class="history-score">${(game.score || 0).toLocaleString()} очков</div>
                                    <div class="history-date">${dateStr}</div>
                                </div>
                            </div>
                            <div class="history-stats">
                                <div class="history-hits">${game.targetsHit || 0} попаданий</div>
                                <div class="history-accuracy">${accuracy}% точность</div>
                            </div>
                        </div>
                    `;
                }).join('');
            } else {
                emptyEl.style.display = 'block';
            }
        } else {
            console.log('❌ Профиль не найден или ошибка:', response);
        }
    } catch (error) {
        console.log('❌ Не удалось загрузить профиль:', error);
    }
}

// ============================================
// ИСПРАВЛЕНИЯ БАГОВ
// ============================================

// Баг #3: Пауза при сворачивании
document.addEventListener('visibilitychange', () => {
    if (document.hidden && gameState.isPlaying) {
        // Ставим на паузу когда страница скрыта
        settingsModal.classList.add('active');
    }
});

// Баг #4: Утечка памяти — очистка при выходе
function cleanupGame() {
    // Очищаем частицы
    if (particles && particles.particles) {
        particles.particles.forEach(p => {
            if (p.geometry) p.geometry.dispose();
            if (p.material) p.material.dispose();
            scene.remove(p);
        });
        particles.particles = [];
    }
    
    // Очищаем диски
    discs.forEach(d => {
        if (d.group) scene.remove(d.group);
    });
    
    console.log('🧹 Игра очищена');
}

// Баг #5: Камера остаётся активной
function stopCamera() {
    try {
        console.log('🛑 Останавливаем камеру...');
        
        // Останавливаем камеру
        if (webcam && webcam.srcObject) {
            webcam.srcObject.getTracks().forEach(track => {
                track.stop();
                console.log('📷 Трек остановлен:', track.kind);
            });
            webcam.srcObject = null;
        }
        
        // Сбрасываем MediaPipe hands
        hands = null;
        
        // ВАЖНО: сбрасываем флаг для полной реинициализации
        gameInitialized = false;
        
        // Показываем загрузочный экран для следующего запуска
        loadingOverlay.classList.remove('hidden');
        loadingStatus.textContent = 'Готов к запуску...';
        loadingStatus.style.color = '';
        
        console.log('✅ Камера остановлена, gameInitialized =', gameInitialized);
    } catch (e) {
        console.error('❌ Ошибка остановки камеры:', e);
        // Даже при ошибке сбрасываем флаг
        gameInitialized = false;
    }
}

// Вызываем cleanup при закрытии страницы
window.addEventListener('beforeunload', () => {
    stopCamera();
    cleanupGame();
});

// Telegram: кнопка "Назад"
if (typeof TelegramService !== 'undefined' && TelegramService.isInTelegram()) {
    // В игре показываем кнопку назад
    const originalExitGame = exitGameBtn.onclick;
    
    // Когда входим в игру — показываем кнопку "Назад"
    const originalStartGame = startGameBtn.onclick;
    startGameBtn.addEventListener('click', () => {
        TelegramService.showBackButton(() => {
            settingsModal.classList.add('active');
        });
    });
}