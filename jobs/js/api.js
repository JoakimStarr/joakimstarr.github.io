console.log('=== API.JS LOADED (JOBWEB STATIC ADAPTER) ===');

const API_TIMEOUT = 30000;
const AUTH_TOKEN_STORAGE_KEY = 'finintern_auth_token';
const AUTH_USER_STORAGE_KEY = 'finintern_auth_user';

// ============ 密码加密工具 ============
const PasswordCrypto = {
    // 生成随机盐值
    generateSalt: function(length = 16) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let salt = '';
        for (let i = 0; i < length; i++) {
            salt += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return salt;
    },

    // SHA-256 哈希函数
    hashPassword: async function(password, salt) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password + salt);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },

    // 加密密码（返回 salt:hash 格式）
    encrypt: async function(password) {
        const salt = this.generateSalt();
        const hash = await this.hashPassword(password, salt);
        return `${salt}:${hash}`;
    },

    // 验证密码
    verify: async function(password, encryptedPassword) {
        if (!encryptedPassword || !encryptedPassword.includes(':')) return false;
        const [salt, hash] = encryptedPassword.split(':');
        const computedHash = await this.hashPassword(password, salt);
        return computedHash === hash;
    }
};

// ============ 渐进式数据加载支持 ============
const DataLoader = {
    config: {
        totalChunks: 8,
        priorityChunkIndex: 0,
        loadedChunks: new Set(),
        isLoading: false,
        loadStartTime: Date.now(),
        useCache: true
    },

    state: {
        priorityLoaded: false,
        allLoaded: false,
        progress: 0,
        callbacks: [],
        cacheRestored: false
    },

    // 初始化 - 检查已加载的块
    init: function() {
        // 检查是否从缓存恢复了数据
        if (window.JOBWEB_CACHE_RESTORED) {
            this.state.cacheRestored = true;
            const jobs = this.getJobs();
            console.log(`[DataLoader] 从缓存恢复 ${jobs.length} 条数据`);

            // 缓存数据完整，标记为全部加载，不再从网络加载
            this.state.allLoaded = true;
            this.state.priorityLoaded = true;
            for (let i = 0; i < this.config.totalChunks; i++) {
                this.config.loadedChunks.add(i);
            }
            this._notifyAllLoaded();
            return;
        }

        // 没有缓存，使用正常加载流程
        if (window.JOBWEB_PRIORITY_LOADED) {
            this.state.priorityLoaded = true;
            this.config.loadedChunks.add(0);
            this._notifyPriorityLoaded();
        }
        // 检查其他块
        for (let i = 1; i < this.config.totalChunks; i++) {
            if (window[`JOBWEB_CHUNK_${i}_LOADED`]) {
                this.config.loadedChunks.add(i);
            }
        }
        if (this.config.loadedChunks.size >= this.config.totalChunks) {
            this.state.allLoaded = true;
        }
    },

    // 加载剩余数据块（后台静默加载）
    loadRemaining: async function(onProgress) {
        if (this.config.isLoading || this.state.allLoaded) return;
        this.config.isLoading = true;

        const remainingChunks = [];
        for (let i = 1; i < this.config.totalChunks; i++) {
            if (!this.config.loadedChunks.has(i)) {
                remainingChunks.push(i);
            }
        }

        const total = remainingChunks.length;
        let loaded = 0;

        // 串行加载，避免阻塞主线程
        for (const chunkIndex of remainingChunks) {
            try {
                await this._loadChunk(chunkIndex);
                loaded++;
                this.state.progress = Math.round((loaded / total) * 100);

                // 触发数据更新事件，通知页面刷新
                this._notifyDataUpdated();

                if (onProgress) {
                    onProgress({
                        loaded: loaded,
                        total: total,
                        progress: this.state.progress,
                        chunkIndex: chunkIndex
                    });
                }

                // 让出主线程，避免阻塞用户操作
                if (chunkIndex < remainingChunks[remainingChunks.length - 1]) {
                    await new Promise(resolve => setTimeout(resolve, 5));
                }
            } catch (err) {
                console.warn('加载数据块失败:', chunkIndex, err);
            }
        }

        this.config.isLoading = false;
        this.state.allLoaded = true;

        // 保存到缓存
        if (this.config.useCache && JobCache) {
            const jobs = this.getJobs();
            const meta = this.getMeta();
            JobCache.saveToCache(jobs, meta);
        }

        this._notifyAllLoaded();
    },

    // 预加载（使用 requestIdleCallback 在浏览器空闲时加载）
    preload: function() {
        const loadFn = () => this.loadRemaining();

        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => {
                loadFn();
            }, { timeout: 3000 });
        } else {
            setTimeout(loadFn, 50);
        }
    },

    // 获取当前可用的数据
    getJobs: function() {
        return (window.JOBWEB_SNAPSHOT && window.JOBWEB_SNAPSHOT.jobs) || [];
    },

    // 获取元数据
    getMeta: function() {
        return (window.JOBWEB_META) || (window.JOBWEB_SNAPSHOT && window.JOBWEB_SNAPSHOT.meta) || {};
    },

    // 检查加载状态
    isPriorityLoaded: function() {
        return this.state.priorityLoaded;
    },

    isAllLoaded: function() {
        return this.state.allLoaded;
    },

    // 等待优先数据加载
    waitForPriority: function() {
        return new Promise((resolve) => {
            if (this.state.priorityLoaded) {
                resolve();
            } else {
                this.state.callbacks.push({ type: 'priority', resolve });
            }
        });
    },

    // 等待所有数据加载
    waitForAll: function() {
        return new Promise((resolve) => {
            if (this.state.allLoaded) {
                resolve();
            } else {
                this.state.callbacks.push({ type: 'all', resolve });
            }
        });
    },

    // 内部方法：加载单个数据块
    _loadChunk: function(index) {
        return new Promise((resolve, reject) => {
            if (this.config.loadedChunks.has(index)) {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = `./data/jobs.chunk.${index}.js`;
            script.async = true;

            script.onload = () => {
                this.config.loadedChunks.add(index);
                resolve();
            };

            script.onerror = () => {
                reject(new Error('Failed to load chunk ' + index));
            };

            document.head.appendChild(script);
        });
    },

    _notifyPriorityLoaded: function() {
        this.state.callbacks
            .filter(cb => cb.type === 'priority')
            .forEach(cb => cb.resolve());
        this.state.callbacks = this.state.callbacks.filter(cb => cb.type !== 'priority');
    },

    _notifyAllLoaded: function() {
        this.state.callbacks.forEach(cb => cb.resolve());
        this.state.callbacks = [];
    },

    // 通知数据已更新（每次加载新数据块后调用）
    _notifyDataUpdated: function() {
        // 触发自定义事件，通知页面数据已更新
        if (typeof window !== 'undefined') {
            const event = new CustomEvent('jobweb:dataUpdated', {
                detail: {
                    totalJobs: this.getJobs().length,
                    isAllLoaded: this.state.allLoaded,
                    progress: this.state.progress
                }
            });
            window.dispatchEvent(event);
        }
    }
};

// 自动初始化
DataLoader.init();

// ============ 数据缓存管理 ============
const JobCache = {
    // 缓存配置
    config: {
        CACHE_KEY: 'jobweb_jobs_cache_v1',
        META_KEY: 'jobweb_meta_cache_v1',
        CACHE_VERSION: '1.0',
        MAX_CACHE_AGE: 7 * 24 * 60 * 60 * 1000, // 7天
    },

    // 初始化缓存
    init: function() {
        // 尝试从缓存恢复数据
        this.restoreFromCache();
    },

    _extractGeneratedAt: function(meta) {
        if (!meta || typeof meta !== 'object') return '';
        if (meta.generated_at) return String(meta.generated_at);
        if (meta.meta && meta.meta.generated_at) return String(meta.meta.generated_at);
        return '';
    },

    // 保存数据到缓存
    saveToCache: function(jobs, meta) {
        try {
            if (!jobs || jobs.length === 0) return;

            const cacheData = {
                version: this.config.CACHE_VERSION,
                timestamp: Date.now(),
                jobCount: jobs.length,
                jobs: jobs,
                meta: meta || {},
                generatedAt: this._extractGeneratedAt(meta || {})
            };

            // 由于数据量大，使用分段存储
            this._saveChunked(cacheData);
            console.log(`[JobCache] 已缓存 ${jobs.length} 条岗位数据`);
        } catch (err) {
            console.warn('[JobCache] 缓存数据失败:', err);
        }
    },

    // 分段存储大数据
    _saveChunked: function(cacheData) {
        const CHUNK_SIZE = 1000; // 每1000条一个分段
        const jobs = cacheData.jobs;
        const chunks = Math.ceil(jobs.length / CHUNK_SIZE);

        // 保存元数据
        const metaInfo = {
            version: cacheData.version,
            timestamp: cacheData.timestamp,
            jobCount: cacheData.jobCount,
            chunks: chunks,
            meta: cacheData.meta,
            generatedAt: cacheData.generatedAt || this._extractGeneratedAt(cacheData.meta)
        };
        localStorage.setItem(this.config.META_KEY, JSON.stringify(metaInfo));

        // 分段保存数据
        for (let i = 0; i < chunks; i++) {
            const chunk = jobs.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            localStorage.setItem(
                `${this.config.CACHE_KEY}_chunk_${i}`,
                JSON.stringify(chunk)
            );
        }
    },

    // 从缓存恢复数据
    restoreFromCache: function() {
        try {
            const metaStr = localStorage.getItem(this.config.META_KEY);
            if (!metaStr) return false;

            const metaInfo = JSON.parse(metaStr);

            // 检查缓存版本
            if (metaInfo.version !== this.config.CACHE_VERSION) {
                console.log('[JobCache] 缓存版本不匹配，清空缓存');
                this.clearCache();
                return false;
            }

            // 检查缓存是否过期
            if (Date.now() - metaInfo.timestamp > this.config.MAX_CACHE_AGE) {
                console.log('[JobCache] 缓存已过期，清空缓存');
                this.clearCache();
                return false;
            }

            // 检查生成时间是否一致（不一致代表静态快照已更新）
            const currentGeneratedAt = this._extractGeneratedAt(window.JOBWEB_META || (window.JOBWEB_SNAPSHOT && window.JOBWEB_SNAPSHOT.meta) || {});
            const cachedGeneratedAt = this._extractGeneratedAt(metaInfo);
            if (currentGeneratedAt && cachedGeneratedAt && currentGeneratedAt !== cachedGeneratedAt) {
                console.log(`[JobCache] 检测到快照生成时间变化（cache=${cachedGeneratedAt}, current=${currentGeneratedAt}），自动清空缓存`);
                this.clearCache();
                return false;
            }

            // 恢复数据
            const jobs = [];
            for (let i = 0; i < metaInfo.chunks; i++) {
                const chunkStr = localStorage.getItem(`${this.config.CACHE_KEY}_chunk_${i}`);
                if (chunkStr) {
                    const chunk = JSON.parse(chunkStr);
                    jobs.push(...chunk);
                }
            }

            if (jobs.length > 0) {
                // 恢复到 window.JOBWEB_SNAPSHOT
                window.JOBWEB_SNAPSHOT = window.JOBWEB_SNAPSHOT || {};
                window.JOBWEB_SNAPSHOT.jobs = jobs;
                window.JOBWEB_SNAPSHOT.meta = metaInfo.meta;
                window.JOBWEB_CACHE_RESTORED = true;

                console.log(`[JobCache] 从缓存恢复 ${jobs.length} 条岗位数据`);
                return true;
            }
        } catch (err) {
            console.warn('[JobCache] 恢复缓存失败:', err);
        }
        return false;
    },

    // 清空缓存
    clearCache: function() {
        try {
            const metaStr = localStorage.getItem(this.config.META_KEY);
            if (metaStr) {
                const metaInfo = JSON.parse(metaStr);
                for (let i = 0; i < metaInfo.chunks; i++) {
                    localStorage.removeItem(`${this.config.CACHE_KEY}_chunk_${i}`);
                }
            }
            localStorage.removeItem(this.config.META_KEY);
            console.log('[JobCache] 缓存已清空');
        } catch (err) {
            console.warn('[JobCache] 清空缓存失败:', err);
        }
    },

    // 检查是否有有效缓存
    hasValidCache: function() {
        try {
            const metaStr = localStorage.getItem(this.config.META_KEY);
            if (!metaStr) return false;

            const metaInfo = JSON.parse(metaStr);
            if (metaInfo.version !== this.config.CACHE_VERSION) return false;
            if (Date.now() - metaInfo.timestamp > this.config.MAX_CACHE_AGE) return false;

            const currentGeneratedAt = this._extractGeneratedAt(window.JOBWEB_META || (window.JOBWEB_SNAPSHOT && window.JOBWEB_SNAPSHOT.meta) || {});
            const cachedGeneratedAt = this._extractGeneratedAt(metaInfo);
            if (currentGeneratedAt && cachedGeneratedAt && currentGeneratedAt !== cachedGeneratedAt) return false;

            return true;
        } catch (err) {
            return false;
        }
    },

    // 获取缓存统计
    getCacheStats: function() {
        try {
            const metaStr = localStorage.getItem(this.config.META_KEY);
            if (!metaStr) return null;

            const metaInfo = JSON.parse(metaStr);
            return {
                jobCount: metaInfo.jobCount,
                timestamp: metaInfo.timestamp,
                age: Date.now() - metaInfo.timestamp,
                ageFormatted: this._formatAge(Date.now() - metaInfo.timestamp)
            };
        } catch (err) {
            return null;
        }
    },

    _formatAge: function(ms) {
        const minutes = Math.floor(ms / 60000);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}天前`;
        if (hours > 0) return `${hours}小时前`;
        if (minutes > 0) return `${minutes}分钟前`;
        return '刚刚';
    }
};

// 初始化缓存
JobCache.init();

const STORAGE_KEYS = {
    favorites: 'jobweb_favorites_v1',
    progress: 'jobweb_progress_v1',
    timeline: 'jobweb_timeline_v1',
    recommendationHistory: 'jobweb_recommendation_history_v1',
    subscriptions: 'jobweb_subscriptions_v1',
    users: 'jobweb_users_v1',
    systemConfig: 'jobweb_system_config_v1',
    aiCache: 'jobweb_ai_cache_v1',
    aiStats: 'jobweb_ai_stats_v1',
    crawlerLogs: 'jobweb_crawler_logs_v1',
    maintenance: 'jobweb_maintenance_v1',
};

const ROLE_DEFINITIONS = [
    { id: 'admin', label: '管理员', permissions: ['view_jobs', 'view_stats', 'use_recommendations', 'manage_crawler', 'view_system', 'manage_users'] },
    { id: 'operator', label: '运营', permissions: ['view_jobs', 'view_stats', 'use_recommendations', 'manage_crawler', 'view_system'] },
    { id: 'viewer', label: '访客', permissions: ['view_jobs', 'view_stats', 'use_recommendations'] },
];

const DEFAULT_USERS = [
    { id: 1, username: 'admin', password: 'Admin@123456', display_name: '系统管理员', role: 'admin', is_active: true, last_login_at: '' },
    { id: 2, username: 'operator', password: 'Operator@123', display_name: '采集运营', role: 'operator', is_active: true, last_login_at: '' },
    { id: 3, username: 'viewer', password: 'Viewer@123', display_name: '普通访客', role: 'viewer', is_active: true, last_login_at: '' },
];

const DATE_RANGE_OPTIONS = [
    { value: 'today', label: '今日发布' },
    { value: '3d', label: '近 3 天' },
    { value: '7d', label: '近 7 天' },
    { value: '30d', label: '近 30 天' },
    { value: 'year', label: '今年以来' },
];

const SOURCE_QUALITY_MAP = {
    '国家大学生就业服务平台': { tier: 'A', frequency: '高频', weight: 0.96, reason: '公开平台稳定，字段较完整。' },
    '上海财经大学': { tier: 'A', frequency: '高频', weight: 0.92, reason: '校方平台来源可靠，更新频率高。' },
    '中央财经大学': { tier: 'A', frequency: '高频', weight: 0.93, reason: '来源权威，岗位信息较完整。' },
    '西南财经大学': { tier: 'A', frequency: '高频', weight: 0.91, reason: '岗位覆盖多，发布时间识别稳定。' },
    '对外经济贸易大学': { tier: 'A', frequency: '中频', weight: 0.9, reason: '内容规范度较高，适合持续跟踪。' },
    '东北财经大学': { tier: 'B', frequency: '中频', weight: 0.86, reason: '整体质量稳定，局部字段偶有缺失。' },
    '东北大学': { tier: 'B', frequency: '中频', weight: 0.82, reason: '岗位量较大，但行业字段需补充清洗。' },
    '中南财经政法大学': { tier: 'A', frequency: '高频', weight: 0.9, reason: '实习与校招入口清晰，结构字段较完整。' },
    '江西财经大学现代经济管理学院': { tier: 'C', frequency: '低频', weight: 0.72, reason: '来源量较小，字段完整度一般。' },
};

const SKILL_KEYWORDS = ['python', 'sql', 'excel', 'vba', 'ppt', 'wind', 'tableau', 'power bi', 'stata', 'r', 'matlab', 'cfa', 'frm', 'cpa', 'acca', '数据分析', '财务建模', '估值', '行研', '投研', '量化'];
const MAJOR_KEYWORDS = ['金融工程', '金融学', '会计学', '财务管理', '审计学', '统计学', '数学', '经济学', '财政学', '法学', '计算机科学与技术', '软件工程', '数据科学', '人工智能', '工商管理'];
const LOCATION_KEYWORDS = ['北京', '上海', '深圳', '广州', '杭州', '成都', '南京', '苏州', '武汉', '西安', '天津', '重庆', '长沙', '大连', '厦门', '青岛', '郑州'];
const INDUSTRY_KEYWORDS = ['基金', '券商', '投行', '银行', '保险', '资管', '量化', '咨询', '财务', '审计', '研究'];

// 动态获取岗位数据（支持渐进式加载）
function getBaseJobs() {
    const raw = snapshot().jobs || [];
    return raw.slice().sort((a, b) => jobTimestamp(b) - jobTimestamp(a) || Number(b.id || 0) - Number(a.id || 0));
}

// 保持兼容性：BASE_JOBS 作为 getter
Object.defineProperty(window, 'BASE_JOBS', {
    get: getBaseJobs,
    configurable: true
});

class APIError extends Error {
    constructor(message, status = 500, data = null) {
        super(message);
        this.name = 'APIError';
        this.status = status;
        this.data = data;
    }
}

function snapshot() {
    // 优先使用 DataLoader 获取数据，支持渐进式加载
    return {
        meta: DataLoader.getMeta(),
        jobs: DataLoader.getJobs()
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function readStore(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : clone(fallback);
    } catch (_) {
        return clone(fallback);
    }
}

function writeStore(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function nowIso() {
    return new Date().toISOString();
}

function nowLocal() {
    return new Date().toLocaleString('zh-CN', { hour12: false });
}

function text(value) {
    return String(value || '').trim();
}

function unique(items) {
    return Array.from(new Set((items || []).map(item => text(item)).filter(Boolean)));
}

function getRole(roleId) {
    return ROLE_DEFINITIONS.find(role => role.id === roleId) || ROLE_DEFINITIONS[2];
}

function buildPublicUser(user) {
    const role = getRole(user.role);
    return {
        id: user.id,
        username: user.username,
        display_name: user.display_name || user.username,
        role: role.id,
        permissions: role.permissions.slice(),
        is_active: user.is_active !== false,
        last_login_at: user.last_login_at || '',
    };
}

function ensureUsers() {
    const current = readStore(STORAGE_KEYS.users, []);
    if (Array.isArray(current) && current.length) return current;
    writeStore(STORAGE_KEYS.users, DEFAULT_USERS);
    return clone(DEFAULT_USERS);
}

function saveUsers(users) {
    writeStore(STORAGE_KEYS.users, users);
}

function currentUser() {
    try {
        return JSON.parse(localStorage.getItem(AUTH_USER_STORAGE_KEY) || 'null');
    } catch (_) {
        return null;
    }
}

function recoverUserFromToken(token) {
    const normalized = String(token || '').trim();
    if (!normalized) return null;
    const match = normalized.match(/^jobweb(?:-local)?-(\d+)-/i);
    if (!match) return null;
    const userId = Number(match[1]);
    if (!Number.isFinite(userId)) return null;

    const matched = ensureUsers().find(item => Number(item.id) === userId && item.is_active !== false);
    if (!matched) return null;

    const publicUser = buildPublicUser(matched);
    localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(publicUser));
    return publicUser;
}

function requireUser() {
    const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    let user = currentUser();
    if ((!user || !user.id) && token) {
        user = recoverUserFromToken(token);
    }
    if (!user || !token) {
        throw new APIError('未登录或登录已过期，请重新登录', 401);
    }
    return user;
}

function favoritesSet() {
    return new Set(readStore(STORAGE_KEYS.favorites, []));
}

function saveFavorites(set) {
    writeStore(STORAGE_KEYS.favorites, Array.from(set));
}

function progressStore() {
    return readStore(STORAGE_KEYS.progress, {});
}

function timelineStore() {
    return readStore(STORAGE_KEYS.timeline, {});
}

function configStore() {
    const metaAi = snapshot().meta?.ai || {};
    const defaultPrimaryModel = metaAi.primary_model || metaAi.model || 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B';
    const defaultFallbackModels = Array.isArray(metaAi.fallback_models)
        ? metaAi.fallback_models.slice()
        : Array.isArray(metaAi.fallbackModels)
            ? metaAi.fallbackModels.slice()
            : [
                'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
                'Qwen/Qwen3-8B',
                'Qwen/Qwen3.5-4B'
            ];
    const defaults = {
        app: { name: snapshot().meta?.app_name || 'FinIntern Hub', version: snapshot().meta?.version || '3.9.2', debug: false },
        crawler: { max_concurrent: 6, request_timeout: 20, retry_attempts: 2, headless: true },
        ai: {
            api_key: String(metaAi.api_key || metaAi.apiKey || '').trim(),
            timeout: Number(metaAi.timeout || 60),
            max_output_tokens: Number(metaAi.maxOutputTokens || 700),
            daily_token_budget: 300000,
            primary_model: defaultPrimaryModel,
            model: defaultPrimaryModel,
            fallback_models: defaultFallbackModels,
        },
        runtime_overrides: {},
    };
    const stored = readStore(STORAGE_KEYS.systemConfig, {});
    const merged = Object.assign({}, defaults, stored);
    merged.app = Object.assign({}, defaults.app, stored.app || {});
    merged.crawler = Object.assign({}, defaults.crawler, stored.crawler || {});
    merged.ai = Object.assign({}, defaults.ai, stored.ai || {});
    if (!merged.ai.primary_model) {
        merged.ai.primary_model = merged.ai.model || defaults.ai.primary_model;
    }
    if (!merged.ai.model) {
        merged.ai.model = merged.ai.primary_model;
    }
    if (!Array.isArray(merged.ai.fallback_models)) {
        merged.ai.fallback_models = defaultFallbackModels.slice();
    }
    merged.ai.api_key = String(merged.ai.api_key || '').trim();
    return merged;
}

function saveConfig(config) {
    writeStore(STORAGE_KEYS.systemConfig, config);
}

function aiStatsStore() {
    const today = new Date().toISOString().slice(0, 10);
    const base = readStore(STORAGE_KEYS.aiStats, {
        day: today, daily_tokens: 0, daily_budget: Number(configStore().ai.daily_token_budget || 300000),
        requests: 0, timeouts: 0, failures: 0, cache_hits: 0, model_switches: 0, by_model: {}, recent_failures: []
    });
    if (base.day !== today) {
        base.day = today;
        base.daily_tokens = 0;
        base.requests = 0;
        base.timeouts = 0;
        base.failures = 0;
        base.cache_hits = 0;
        base.model_switches = 0;
        base.by_model = {};
        base.recent_failures = [];
    }
    return base;
}

function saveAiStats(stats) {
    writeStore(STORAGE_KEYS.aiStats, stats);
}

function aiDefaults() {
    const metaAi = snapshot().meta?.ai || {};
    const system = configStore();
    const baseUrl = String(metaAi.baseUrl || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '');
    const primaryModel = system.ai?.primary_model || system.ai?.model || metaAi.primary_model || metaAi.model || 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B';
    const fallbackModels = Array.isArray(system.ai?.fallback_models)
        ? system.ai.fallback_models.slice()
        : Array.isArray(system.ai?.fallbackModels)
            ? system.ai.fallbackModels.slice()
            : Array.isArray(metaAi.fallback_models)
                ? metaAi.fallback_models.slice()
                : Array.isArray(metaAi.fallbackModels)
                    ? metaAi.fallbackModels.slice()
                    : [];
    return {
        apiKey: String(system.ai?.api_key || metaAi.api_key || metaAi.apiKey || '').trim(),
        baseUrl: baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`,
        model: primaryModel,
        fallbackModels,
        timeout: Number(system.ai?.timeout || metaAi.timeout || 60),
        maxTokens: Number(system.ai?.max_output_tokens || metaAi.maxOutputTokens || 700),
    };
}

function aiCache() {
    return readStore(STORAGE_KEYS.aiCache, {});
}

function saveAiCache(cache) {
    writeStore(STORAGE_KEYS.aiCache, cache);
}

const AI_CACHE_TTL_MS = 25 * 60 * 1000;
const AI_CACHE_LIMIT = 140;
const AI_MAX_CONCURRENT_REQUESTS = 3;
const AI_MAX_INPUT_CHARS = 12000;
const AI_INFLIGHT_REQUESTS = new Map();
let aiActiveRequests = 0;
const aiQueue = [];

function hash(input) {
    let value = 0;
    const content = String(input || '');
    for (let i = 0; i < content.length; i += 1) {
        value = ((value << 5) - value) + content.charCodeAt(i);
        value |= 0;
    }
    return `h${Math.abs(value)}`;
}

function getAiCacheTtlMs(scope, options = {}) {
    if (Number(options.cacheTtlMs) > 0) return Number(options.cacheTtlMs);
    const scene = String(scope || '').toLowerCase();
    if (scene.includes('chat')) return 4 * 60 * 1000;
    if (scene.includes('interview') || scene.includes('analysis')) return 20 * 60 * 1000;
    return AI_CACHE_TTL_MS;
}

function pruneAiCache(cache, nowTs = Date.now()) {
    const entries = Object.entries(cache || {});
    const valid = entries
        .filter(([, item]) => {
            const createdAt = new Date(item?.created_at || '').getTime();
            const ttl = Number(item?.ttl_ms || AI_CACHE_TTL_MS);
            return item?.answer && createdAt && (nowTs - createdAt) <= ttl;
        })
        .sort((a, b) => new Date(b[1].created_at).getTime() - new Date(a[1].created_at).getTime())
        .slice(0, AI_CACHE_LIMIT);
    return Object.fromEntries(valid);
}

function compactMessagesForAi(messages, limitChars = AI_MAX_INPUT_CHARS) {
    const items = Array.isArray(messages) ? messages : [];
    if (!items.length) return [];
    const safeLimit = Math.max(2500, Number(limitChars || AI_MAX_INPUT_CHARS));
    const compacted = [];
    let total = 0;
    for (let i = items.length - 1; i >= 0; i -= 1) {
        const msg = items[i] || {};
        const role = msg.role || 'user';
        const cap = role === 'system' ? 3600 : 2600;
        const content = String(msg.content || '').slice(0, cap);
        if (!content) continue;
        if (total > 0 && total + content.length > safeLimit) break;
        compacted.unshift({ role, content });
        total += content.length;
    }
    if (!compacted.length && items[0]?.content) {
        compacted.push({ role: items[0].role || 'user', content: String(items[0].content).slice(0, safeLimit) });
    }
    return compacted;
}

function buildAiInflightKey(scope, model, messages, cacheKey) {
    if (cacheKey) return `cache:${cacheKey}`;
    return `run:${scope || 'ai'}:${model || 'default'}:${hash(JSON.stringify(messages || []))}`;
}

function withAiConcurrency(task) {
    return new Promise((resolve, reject) => {
        const run = () => {
            aiActiveRequests += 1;
            Promise.resolve()
                .then(task)
                .then(resolve)
                .catch(reject)
                .finally(() => {
                    aiActiveRequests = Math.max(0, aiActiveRequests - 1);
                    const next = aiQueue.shift();
                    if (next) next();
                });
        };
        if (aiActiveRequests < AI_MAX_CONCURRENT_REQUESTS) run();
        else aiQueue.push(run);
    });
}

function estimateTokens(messages, answer) {
    const input = (messages || []).reduce((sum, item) => sum + String(item.content || '').length, 0);
    return Math.ceil((input + String(answer || '').length) / 4);
}

function recordAiSuccess(model, messages, answer, switched) {
    const stats = aiStatsStore();
    const tokens = estimateTokens(messages, answer);
    stats.requests += 1;
    stats.daily_budget = Number(configStore().ai.daily_token_budget || stats.daily_budget || 300000);
    stats.daily_tokens += tokens;
    stats.by_model[model] = (stats.by_model[model] || 0) + tokens;
    if (switched) stats.model_switches += 1;
    saveAiStats(stats);
}

function recordAiFailure(model, error) {
    const stats = aiStatsStore();
    stats.failures += 1;
    if (/超时|timeout/i.test(String(error && error.message || ''))) stats.timeouts += 1;
    stats.recent_failures = [{
        time: nowLocal(),
        model: model || 'unknown',
        message: String(error && error.message || error || 'AI 请求失败'),
    }].concat(stats.recent_failures || []).slice(0, 8);
    saveAiStats(stats);
}

function recordAiCacheHit() {
    const stats = aiStatsStore();
    stats.cache_hits += 1;
    saveAiStats(stats);
}

async function callAi(messages, options = {}) {
    if (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:') {
        throw new Error('当前页面通过 file:// 打开，浏览器会限制网络与跨源行为；请使用本地 HTTP 服务访问（如 hexo server）。');
    }
    const config = aiDefaults();
    if (!config.apiKey) throw new Error('当前未配置可用的 SiliconFlow API Key');
    const models = unique([options.model || config.model, ...(config.fallbackModels || [])]);
    const preparedMessages = compactMessagesForAi(messages, options.maxInputChars || AI_MAX_INPUT_CHARS);
    if (!preparedMessages.length) throw new Error('AI 输入为空，无法发起请求');
    const cacheKey = options.cacheKey ? `${options.scope || 'ai'}:${hash(JSON.stringify(options.cacheKey))}` : '';
    const ttlMs = getAiCacheTtlMs(options.scope, options);
    if (cacheKey) {
        const cache = pruneAiCache(aiCache());
        const cached = cache[cacheKey];
        if (Object.keys(cache).length !== Object.keys(aiCache()).length) saveAiCache(cache);
        if (cached?.answer) {
            recordAiCacheHit();
            return { answer: cached.answer, model: cached.model || models[0], cached: true };
        }
    }

    const inflightKey = buildAiInflightKey(options.scope, models[0], preparedMessages, cacheKey);
    if (AI_INFLIGHT_REQUESTS.has(inflightKey)) {
        return AI_INFLIGHT_REQUESTS.get(inflightKey);
    }

    const invokePromise = withAiConcurrency(async () => {
        let lastError = null;
        for (let index = 0; index < models.length; index += 1) {
            const model = models[index];
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), Math.max(12000, Number(options.timeout || config.timeout || 60) * 1000));
            try {
                const response = await fetch(config.baseUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${config.apiKey}`,
                    },
                    body: JSON.stringify({
                        model,
                        messages: preparedMessages,
                        stream: Boolean(options.stream),
                        max_tokens: Number(options.maxTokens || config.maxTokens || 700),
                    }),
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`模型 ${model} 请求失败：${response.status} ${errorText.slice(0, 160)}`);
                }

                let answer = '';
                if (options.stream) {
                    const reader = response.body?.getReader?.();
                    if (reader) {
                        const decoder = new TextDecoder('utf-8');
                        let buffer = '';
                        while (true) {
                            const chunk = await reader.read();
                            if (chunk.done) break;
                            buffer += decoder.decode(chunk.value, { stream: true });
                            const lines = buffer.split('\n');
                            buffer = lines.pop() || '';
                            lines.forEach(line => {
                                const trimmed = line.trim();
                                if (!trimmed || !trimmed.startsWith('data:')) return;
                                const data = trimmed.replace(/^data:\s*/, '');
                                if (data === '[DONE]') return;
                                try {
                                    const json = JSON.parse(data);
                                    const delta = json?.choices?.[0]?.delta || {};
                                    if (delta.content) answer += delta.content;
                                } catch (e) {
                                    // 忽略解析错误
                                }
                            });
                        }
                    }
                }
                if (!answer) {
                    const json = await response.json();
                    answer = json?.choices?.[0]?.message?.content || '';
                }

                if (!answer) {
                    throw new Error(`模型 ${model} 返回空内容`);
                }

                recordAiSuccess(model, preparedMessages, answer, index > 0);
                if (cacheKey) {
                    const cache = pruneAiCache(aiCache());
                    cache[cacheKey] = { answer, model, created_at: nowIso(), ttl_ms: ttlMs };
                    saveAiCache(pruneAiCache(cache));
                }
                return { answer, model, cached: false };
            } catch (error) {
                clearTimeout(timeoutId);
                const normalized = error.name === 'AbortError' ? new Error(`模型 ${model} 请求超时`) : error;
                lastError = normalized;
                recordAiFailure(model, normalized);
                console.warn(`AI 模型 ${model} 调用失败:`, normalized.message);
            }
        }
        throw lastError || new Error('AI 请求失败，所有模型均不可用');
    });

    AI_INFLIGHT_REQUESTS.set(inflightKey, invokePromise);
    return invokePromise.finally(() => {
        AI_INFLIGHT_REQUESTS.delete(inflightKey);
    });
}

function requireAiAnswer(result, scene) {
    const answer = String(result?.answer || '').trim();
    if (!answer) {
        throw new Error(`${scene} 未返回有效内容`);
    }
    return answer;
}

function parseAiJsonObject(answer, scene) {
    const raw = String(answer || '').trim();
    if (!raw) {
        throw new Error(`${scene} 返回为空`);
    }

    const tryParse = (textValue) => {
        try {
            return JSON.parse(textValue);
        } catch (error) {
            return null;
        }
    };

    const parseObjectLike = (textValue) => {
        const parsed = tryParse(textValue);
        return parsed && typeof parsed === 'object' ? parsed : null;
    };

    const extractFirstJsonCandidate = (textValue) => {
        const text = String(textValue || '');
        const start = text.search(/[\[{]/);
        if (start < 0) return null;

        let inString = false;
        let escape = false;
        const stack = [];

        for (let index = start; index < text.length; index += 1) {
            const char = text[index];

            if (inString) {
                if (escape) {
                    escape = false;
                    continue;
                }
                if (char === '\\') {
                    escape = true;
                    continue;
                }
                if (char === '"') {
                    inString = false;
                }
                continue;
            }

            if (char === '"') {
                inString = true;
                continue;
            }

            if (char === '{' || char === '[') {
                stack.push(char);
                continue;
            }

            if (char === '}' || char === ']') {
                const opening = stack.pop();
                if (!opening) return null;
                if ((opening === '{' && char !== '}') || (opening === '[' && char !== ']')) {
                    return null;
                }
                if (!stack.length) {
                    return text.slice(start, index + 1);
                }
            }
        }

        return null;
    };

    const candidates = [raw];

    const fencedBlocks = raw.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi);
    for (const block of fencedBlocks) {
        if (block?.[1]) {
            candidates.push(String(block[1]).trim());
        }
    }

    const unfinishedFence = raw.match(/```(?:json)?\s*([\s\S]*)$/i);
    if (unfinishedFence?.[1]) {
        candidates.push(String(unfinishedFence[1]).trim());
    }

    const extractedFromRaw = extractFirstJsonCandidate(raw);
    if (extractedFromRaw) {
        candidates.push(extractedFromRaw);
    }

    for (const candidate of candidates) {
        const parsed = parseObjectLike(candidate);
        if (parsed) return parsed;

        const extracted = extractFirstJsonCandidate(candidate);
        if (!extracted || extracted === candidate) continue;
        const extractedParsed = parseObjectLike(extracted);
        if (extractedParsed) return extractedParsed;
    }

    throw new Error(`${scene} 返回格式无效，请检查模型输出是否为 JSON`);
}

async function repairAiJsonObject(answer, scene, schemaHint = '{}') {
    const raw = String(answer || '').trim();
    if (!raw) return raw;

    const messages = normalizeMessages(
        '你是 JSON 修复助手。你只能输出严格 JSON，不要输出 Markdown 代码块，不要输出解释文本。',
        `任务：把下面内容修复为严格 JSON。\n\n场景：${scene}\n目标结构示例：${schemaHint}\n\n原始内容：\n${raw}`,
        []
    );

    const repaired = await callAi(messages, {
        scope: `${scene}-json-repair`,
        cacheKey: { scene, raw_hash: hash(raw), mode: 'json-repair' },
        timeout: 30,
        maxTokens: 420,
        stream: false,
        maxInputChars: 12000,
    });

    return requireAiAnswer(repaired, `${scene} JSON修复`);
}

function createAiApiError(error) {
    return new APIError('AI 分析失败：' + (error?.message || '请检查 API Key 配置'), 500);
}

function evictAiCacheByScopeKey(scope, cacheKeyObj) {
    if (!cacheKeyObj) return;
    const key = `${scope || 'ai'}:${hash(JSON.stringify(cacheKeyObj))}`;
    const cache = pruneAiCache(aiCache());
    if (!cache[key]) return;
    delete cache[key];
    saveAiCache(cache);
}

async function runAiTextScene(scene, options = {}) {
    const {
        systemPrompt = '',
        userPrompt = '',
        history = [],
        callOptions = {},
        logLabel = `AI ${scene}失败`,
    } = options;

    try {
        const messages = normalizeMessages(systemPrompt, userPrompt, history);
        const result = await callAi(messages, callOptions);
        return {
            answer: requireAiAnswer(result, scene),
            model: result.model || null,
            raw: result,
        };
    } catch (error) {
        console.warn(logLabel + ':', error);
        throw createAiApiError(error);
    }
}

async function runAiJsonScene(scene, options = {}) {
    const {
        schemaHint = '{}',
        logLabel = `AI ${scene}失败`,
        ...textSceneOptions
    } = options;

    try {
        const { answer, model, raw } = await runAiTextScene(scene, {
            ...textSceneOptions,
            logLabel,
        });

        let parsed;
        try {
            parsed = parseAiJsonObject(answer, scene);
        } catch (parseError) {
            evictAiCacheByScopeKey(textSceneOptions?.callOptions?.scope, textSceneOptions?.callOptions?.cacheKey);
            const repairedAnswer = await repairAiJsonObject(answer, scene, schemaHint);
            parsed = parseAiJsonObject(repairedAnswer, scene);
        }

        return { parsed, model, answer, raw };
    } catch (error) {
        if (error instanceof APIError) throw error;
        console.warn(logLabel + ':', error);
        throw createAiApiError(error);
    }
}

function normalizeMessages(systemPrompt, userPrompt, history) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    (history || []).forEach(item => {
        if (item?.role && item?.content) messages.push({ role: item.role, content: String(item.content) });
    });
    messages.push({ role: 'user', content: userPrompt });
    return messages;
}

function jobTimestamp(job) {
    const date = new Date(job.publish_date || job.created_at || '');
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function qualityInfo(job) {
    const fields = [job.title, job.company, job.location, job.job_type, job.industry, job.category, job.education, job.salary, job.description, job.requirements, job.source, job.publish_date].filter(Boolean).length;
    const completeness = Math.round((fields / 12) * 56);
    const narrative = Math.min(20, Math.round((String(job.description || '').length + String(job.requirements || '').length) / 40));
    const publish = job.publish_date ? 10 : 4;
    const sourceMeta = SOURCE_QUALITY_MAP[job.source] || { weight: 0.75 };
    const score = Math.min(100, completeness + narrative + publish + Math.round(sourceMeta.weight * 14));
    return {
        score,
        level: score >= 88 ? '高质量' : score >= 74 ? '良好' : score >= 58 ? '一般' : '待补充',
        summary: `${fields >= 10 ? '字段较完整' : '字段仍有缺口'}，${narrative >= 14 ? '正文可信度较高' : '正文仍需清洗'}，${sourceMeta.weight >= 0.88 ? '来源可靠' : '来源权重一般'}`,
    };
}

function allJobs() {
    const favorites = favoritesSet();
    const progress = progressStore();
    // 基于预排序基线，叠加收藏/进度/质量评分，避免每次重复排序
    return getBaseJobs().map(raw => {
        const job = clone(raw);
        const quality = qualityInfo(job);
        const progressItem = progress[String(job.id)] || {};
        return {
            ...job,
            is_favorite: favorites.has(job.id),
            application_status: progressItem.status || job.application_status || '未投递',
            application_notes: progressItem.notes || job.application_notes || '',
            application_updated_at: progressItem.updated_at || '',
            quality_score: quality.score,
            quality_level: quality.level,
            quality_summary: quality.summary,
        };
    });
}

function compareText(job) {
    return [
        job.title, job.company, job.location, job.job_type, job.industry,
        job.category, job.education, job.experience, job.description, job.requirements,
        ...(Array.isArray(job.tags) ? job.tags : String(job.tags || '').split(/[，,]/))
    ].join(' ').toLowerCase();
}

function matchDateRange(job, range) {
    if (!range) return true;
    const timestamp = jobTimestamp(job);
    if (!timestamp) return range !== 'today';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    if (range === 'today') return timestamp >= today;
    if (range === '3d') return timestamp >= now.getTime() - (3 * dayMs);
    if (range === '7d') return timestamp >= now.getTime() - (7 * dayMs);
    if (range === '30d') return timestamp >= now.getTime() - (30 * dayMs);
    if (range === 'year') return timestamp >= new Date(now.getFullYear(), 0, 1).getTime();
    return true;
}

function filteredJobs(params = {}) {
    const keyword = text(params.keyword || params.q).toLowerCase();
    const location = text(params.location);
    const jobType = text(params.job_type || params.jobType);
    const industry = text(params.industry);
    const category = text(params.category);
    const education = text(params.education);
    const source = text(params.source);
    const dateRange = text(params.date_range || params.dateRange);
    return allJobs().filter(job => {
        if (keyword && !compareText(job).includes(keyword)) return false;
        if (location && !String(job.location || '').includes(location)) return false;
        if (jobType && !String(job.job_type || '').includes(jobType)) return false;
        if (industry && !String(job.industry || '').includes(industry)) return false;
        if (category && !String(job.category || '').includes(category)) return false;
        if (education && !String(job.education || '').includes(education)) return false;
        if (source && String(job.source || '') !== source) return false;
        if (!matchDateRange(job, dateRange)) return false;
        return true;
    });
}

function paginate(items, page, pageSize) {
    const safePage = Math.max(1, Number(page || 1));
    const safeSize = Math.max(1, Number(pageSize || 20));
    const total = items.length;
    return {
        items: items.slice((safePage - 1) * safeSize, safePage * safeSize),
        total,
        page: safePage,
        pages: Math.max(1, Math.ceil(total / safeSize)),
        page_size: safeSize,
    };
}

function buckets(items, key) {
    const counter = new Map();
    items.forEach(item => {
        const label = text(item[key]);
        if (!label) return;
        counter.set(label, (counter.get(label) || 0) + 1);
    });
    return Array.from(counter.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN')).map(([label, count]) => ({ label, count }));
}

function overview() {
    const jobs = allJobs();
    const today = new Date().toISOString().slice(0, 10);
    return {
        total_jobs: jobs.length,
        favorite_jobs: jobs.filter(job => job.is_favorite).length,
        today_jobs: jobs.filter(job => String(job.publish_date || job.created_at || '').slice(0, 10) === today).length,
        sources_count: new Set(jobs.map(job => job.source).filter(Boolean)).size,
    };
}

function filterOptions() {
    const jobs = allJobs();
    const uniqueBy = key => Array.from(new Set(jobs.map(job => text(job[key])).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return {
        locations: uniqueBy('location'),
        education: uniqueBy('education'),
        job_types: uniqueBy('job_type'),
        industries: uniqueBy('industry'),
        sources: uniqueBy('source'),
        categories: uniqueBy('category'),
        publish_date_ranges: clone(DATE_RANGE_OPTIONS),
    };
}

function summarizeJob(job) {
    const combined = `${job.requirements || ''} ${job.description || ''}`.replace(/\s+/g, ' ').trim();
    return combined ? `${combined.slice(0, 420)}${combined.length > 420 ? '...' : ''}` : '暂无岗位描述';
}

function buildProfileSummary(profile) {
    const parts = [];
    if ((profile.keywords || []).length) parts.push(`关键词：${profile.keywords.slice(0, 4).join('、')}`);
    if ((profile.preferred_locations || []).length) parts.push(`地点：${profile.preferred_locations.slice(0, 3).join('、')}`);
    if ((profile.preferred_industries || []).length) parts.push(`行业：${profile.preferred_industries.slice(0, 3).join('、')}`);
    if ((profile.preferred_job_types || []).length) parts.push(`类型：${profile.preferred_job_types.slice(0, 3).join('、')}`);
    if (profile.education) parts.push(`学历：${profile.education}`);
    if (profile.experience) parts.push(`经验：${profile.experience}`);
    if ((profile.skills || []).length) parts.push(`技能：${profile.skills.slice(0, 4).join('、')}`);
    if ((profile.strengths || []).length) parts.push(`优势：${profile.strengths.slice(0, 4).join('、')}`);
    return parts.join(' | ') || '已恢复最近一次缓存内容，你可以继续修改后重新生成推荐。';
}

function compactProfileForAi(profile = {}) {
    return {
        keywords: unique((profile.keywords || []).slice(0, 6)),
        preferred_locations: unique((profile.preferred_locations || []).slice(0, 4)),
        preferred_job_types: unique((profile.preferred_job_types || []).slice(0, 3)),
        preferred_industries: unique((profile.preferred_industries || []).slice(0, 4)),
        education: text(profile.education),
        experience: text(profile.experience),
        target_companies: unique((profile.target_companies || []).slice(0, 3)),
        schools: unique((profile.schools || []).slice(0, 2)),
        majors: unique((profile.majors || []).slice(0, 4)),
        skills: unique((profile.skills || []).slice(0, 8)),
        certifications: unique((profile.certifications || []).slice(0, 4)),
        strengths: unique((profile.strengths || []).slice(0, 5)),
        additional_notes: text(profile.additional_notes).slice(0, 240),
    };
}

function scoreJob(job, profile) {
    const corpus = compareText(job);
    const reasons = [];
    const breakdown = {};
    let score = 0;
    const add = (label, value, reason) => {
        if (!value) return;
        score += value;
        breakdown[label] = (breakdown[label] || 0) + value;
        if (reason) reasons.push(reason);
    };
    (profile.keywords || []).forEach(item => corpus.includes(item.toLowerCase()) && add('关键词', 15, `命中关键词“${item}”`));
    (profile.preferred_locations || []).forEach(item => String(job.location || '').includes(item) && add('地点', 10, `地点符合 ${item}`));
    (profile.preferred_job_types || []).forEach(item => String(job.job_type || '').includes(item) && add('岗位类型', 8, `岗位类型匹配 ${item}`));
    (profile.preferred_industries || []).forEach(item => String(job.industry || '').includes(item) && add('行业', 10, `行业方向匹配 ${item}`));
    if (profile.education && String(job.education || '').includes(profile.education)) add('学历', 8, '学历要求接近');
    (profile.majors || []).forEach(item => corpus.includes(item.toLowerCase()) && add('专业', 8, `专业相关：${item}`));
    (profile.skills || []).forEach(item => corpus.includes(item.toLowerCase()) && add('技能', 6, `技能匹配：${item}`));
    (profile.certifications || []).forEach(item => corpus.includes(item.toLowerCase()) && add('证书', 5, `证书相关：${item}`));
    (profile.target_companies || []).forEach(item => String(job.company || '').includes(item) && add('目标公司', 6, `目标公司命中：${item}`));
    (profile.strengths || []).forEach(item => corpus.includes(item.toLowerCase()) && add('优势', 4, `优势贴合：${item}`));
    add('质量', Math.round((Number(job.quality_score || 0) / 100) * 10), '岗位字段完整度较高');
    return {
        score,
        reasons: unique(reasons).slice(0, 6),
        score_breakdown: breakdown,
        recommendation_tier: score >= 68 ? '冲刺岗' : score >= 46 ? '匹配岗' : '保底岗',
    };
}

function recommendationSummary(item) {
    const job = item.job || {};
    const quickFacts = [
        job.job_type ? `- 类型：${job.job_type}` : '',
        job.industry ? `- 行业：${job.industry}` : '',
        job.education ? `- 学历：${job.education}` : '',
        job.publish_date ? `- 发布时间：${job.publish_date}` : '',
    ].filter(Boolean);
    return [
        `### ${job.title || '未命名岗位'}`,
        '',
        `- 公司：${job.company || '未知公司'}`,
        `- 地点：${job.location || '地点待定'}`,
        `- 薪资：${job.salary || '薪资面议'}`,
        `- 推荐层级：${item.recommendation_tier || '匹配岗'}`,
        ...quickFacts,
        '',
        '#### 为什么推荐',
        ...((item.reasons || []).length ? item.reasons.map(reason => `- ${reason}`) : ['- 当前以基础相关度排序']),
        '',
        '#### 岗位摘要',
        summarizeJob(job),
    ].join('\n');
}

async function buildAiRecommendationSummary(profile, item) {
    const job = item?.job || {};
    const result = await runAiTextScene('推荐岗位分析', {
        logLabel: 'AI 推荐岗位分析失败',
        systemPrompt: '你是一名金融求职顾问。请只输出结构化 Markdown，包含：岗位匹配结论、优势亮点、潜在风险、投递建议（最多4条），不要输出 JSON。',
        userPrompt: `候选人画像：${JSON.stringify(profile || {}, null, 2)}\n\n岗位信息：${JSON.stringify(job, null, 2)}\n\n匹配信息：${JSON.stringify({ score: item?.score || 0, recommendation_tier: item?.recommendation_tier || '', reasons: item?.reasons || [] }, null, 2)}`,
        history: [],
        callOptions: {
            scope: 'recommendation-job-summary',
            cacheKey: {
                profile,
                job_id: job.id || null,
                job_title: job.title || '',
                score: item?.score || 0,
                reasons: item?.reasons || [],
            },
            timeout: 45,
            stream: false,
            maxInputChars: 9000,
        },
    });
    return {
        markdown: result.answer,
        model: result.model,
    };
}

function sanitizePrivacy(textValue) {
    return String(textValue || '')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, '[已隐藏邮箱]')
        .replace(/(?<!\d)(1[3-9]\d{9})(?!\d)/g, '[已隐藏手机号]')
        .replace(/(?<!\d)(0\d{2,3}-?\d{7,8})(?!\d)/g, '[已隐藏电话]');
}

function pickWords(textValue, list, limit = 8) {
    return unique(list.filter(item => String(textValue).toLowerCase().includes(String(item).toLowerCase())).slice(0, limit));
}

function buildResumeProfile(rawText) {
    const content = sanitizePrivacy(rawText);
    return {
        keywords: unique([...pickWords(content, ['量化', '投研', '行研', '固收', '投行', '资管', '财务', '审计', '风控'], 6), ...pickWords(content, MAJOR_KEYWORDS, 2)]).slice(0, 8),
        preferred_locations: pickWords(content, LOCATION_KEYWORDS, 6),
        preferred_job_types: pickWords(content, ['实习', '校招', '全职', '兼职'], 3),
        preferred_industries: pickWords(content, INDUSTRY_KEYWORDS, 5),
        education: /博士/.test(content) ? '博士' : /硕士|研究生/.test(content) ? '硕士' : /本科|学士/.test(content) ? '本科' : /大专|专科/.test(content) ? '大专' : '',
        experience: (content.match(/实习/g) || []).length >= 2 ? '2 段以上实习' : (content.match(/实习/g) || []).length === 1 ? '1 段实习' : (content.match(/项目/g) || []).length ? '有项目经历' : '',
        target_companies: unique((content.match(/[\u4e00-\u9fa5A-Za-z]{2,24}(公司|银行|证券|基金|集团)/g) || []).slice(0, 5)),
        schools: unique((content.match(/[\u4e00-\u9fa5A-Za-z]{2,24}(大学|学院)/g) || []).slice(0, 4)),
        majors: pickWords(content, MAJOR_KEYWORDS, 6),
        skills: pickWords(content, SKILL_KEYWORDS, 10).filter(item => !['cfa', 'frm', 'cpa', 'acca'].includes(item.toLowerCase())),
        certifications: pickWords(content, ['CFA', 'FRM', 'CPA', 'ACCA', '证券从业', '基金从业'], 6),
        strengths: unique([...pickWords(content, ['数据分析', '财务建模', '沟通表达', '行业研究'], 4), ...pickWords(content, SKILL_KEYWORDS, 4)]).slice(0, 6),
        additional_notes: '',
        resume_text: content,
    };
}

function resumeDiagnostic(profile, resumeText) {
    const highlights = [];
    const risks = [];
    if (profile.education) highlights.push(`已识别学历背景：${profile.education}`);
    if ((profile.skills || []).length) highlights.push(`技能关键词：${profile.skills.slice(0, 5).join('、')}`);
    if ((profile.schools || []).length) highlights.push(`院校背景：${profile.schools.slice(0, 2).join('、')}`);
    if ((profile.majors || []).length) highlights.push(`专业方向：${profile.majors.slice(0, 3).join('、')}`);
    if (!(profile.keywords || []).length) risks.push('没有识别出明确的求职方向关键词，建议手动补充。');
    if (!(profile.preferred_locations || []).length) risks.push('没有识别到明确的地点偏好，推荐范围可能偏宽。');
    if (!(profile.skills || []).length) risks.push('技能标签较少，建议补充工具、证书或项目能力。');
    if (String(resumeText || '').length < 160) risks.push('简历正文较短，可能影响匹配精度。');
    const suggestions = [
        '建议在“附加说明”里补充目标岗位方向、到岗时间和不可接受的地点。',
        '如主投研究或量化方向，可补充报告、建模、数据处理相关经历。',
        '如主投财务/审计方向，可补充报表分析、模型和证书进度。',
    ];
    const score = Math.max(55, Math.min(95, 55 + (profile.education ? 10 : 0) + Math.min(12, (profile.skills || []).length * 2) + Math.min(10, (profile.keywords || []).length * 2)));
    return {
        score,
        highlights,
        risks,
        suggestions,
        markdown: ['### 简历诊断', `- 诊断分：**${score} / 100**`, '', '#### 亮点', ...(highlights.length ? highlights.map(item => `- ${item}`) : ['- 暂未识别出明显亮点']), '', '#### 风险点', ...(risks.length ? risks.map(item => `- ${item}`) : ['- 当前未发现明显风险']), '', '#### 优化建议', ...suggestions.map(item => `- ${item}`)].join('\n'),
    };
}

async function loadExternalScript(url, globalName) {
    if (globalName && window[globalName]) return window[globalName];
    await new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-lib="${url}"]`);
        if (existing) {
            existing.addEventListener('load', resolve, { once: true });
            existing.addEventListener('error', reject, { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.dataset.lib = url;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`加载外部脚本失败：${url}`));
        document.head.appendChild(script);
    });
    return globalName ? window[globalName] : true;
}

function normalizeResumeText(value) {
    return String(value || '')
        .replace(/\u0000/g, ' ')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

function isUsefulResumeText(value) {
    const normalized = normalizeResumeText(value);
    const visibleChars = (normalized.match(/[A-Za-z0-9\u4e00-\u9fa5]/g) || []).length;
    return visibleChars >= 24;
}

async function extractPdfEmbeddedText(pdfjsLib, file) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(content.items.map(item => item.str || '').join(' '));
    }
    return {
        pdf,
        text: normalizeResumeText(pages.join('\n\n')),
    };
}

async function recognizeCanvasText(canvas) {
    const Tesseract = await loadExternalScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js', 'Tesseract');
    const result = await Tesseract.recognize(canvas, 'chi_sim+eng', {
        logger: () => {},
    });
    return normalizeResumeText(result?.data?.text || '');
}

async function extractPdfOcrText(pdf) {
    if (!pdf) return '';
    const texts = [];
    const maxPages = Math.min(pdf.numPages || 0, 4);
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.7 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: context, viewport }).promise;
        const pageText = await recognizeCanvasText(canvas);
        if (pageText) texts.push(pageText);
    }
    return normalizeResumeText(texts.join('\n\n'));
}

async function extractImageOcrText(file) {
    const image = await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('图片加载失败'));
        };
        img.src = url;
    });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const maxWidth = 1800;
    const scale = image.width > maxWidth ? maxWidth / image.width : 1;
    canvas.width = Math.max(1, Math.floor(image.width * scale));
    canvas.height = Math.max(1, Math.floor(image.height * scale));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return recognizeCanvasText(canvas);
}

async function extractResumeText(file) {
    const name = String(file?.name || '').toLowerCase();
    if (!file) return { text: '', method: 'none', notice: '' };
    if (name.endsWith('.pdf')) {
        const pdfjsLib = await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js', 'pdfjsLib');
        const { pdf, text } = await extractPdfEmbeddedText(pdfjsLib, file);
        if (isUsefulResumeText(text)) {
            return { text, method: 'pdf-text', notice: '' };
        }
        const ocrText = await extractPdfOcrText(pdf);
        return {
            text: normalizeResumeText(ocrText || text),
            method: ocrText ? 'pdf-ocr' : 'pdf-text',
            notice: ocrText ? '检测到简历更像扫描件，已自动切换 OCR 识别。' : '',
        };
    }
    if (name.endsWith('.docx')) {
        const mammoth = await loadExternalScript('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js', 'mammoth');
        const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
        return { text: normalizeResumeText(result.value || ''), method: 'docx', notice: '' };
    }
    if (/\.(png|jpe?g|webp|bmp)$/i.test(name) || String(file.type || '').startsWith('image/')) {
        const ocrText = await extractImageOcrText(file);
        return {
            text: normalizeResumeText(ocrText),
            method: 'image-ocr',
            notice: '已通过 OCR 识别图片中的简历内容。',
        };
    }
    if (typeof file.text === 'function') {
        return { text: normalizeResumeText(await file.text()), method: 'text', notice: '' };
    }
    return {
        text: normalizeResumeText(new TextDecoder('utf-8').decode(await file.arrayBuffer())),
        method: 'text',
        notice: '',
    };
}

function upsertHistory(record) {
    const current = readStore(STORAGE_KEYS.recommendationHistory, []);
    const fingerprint = hash(JSON.stringify({
        type: record.type,
        filename: record.filename || '',
        summary: record.profile_summary || '',
        preview: record.parsed_text_preview || '',
        returned: record.recommendation?.returned || 0,
    }));
    const next = [{ id: record.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, created_at: record.created_at || nowLocal(), ...record }, ...current.filter(item => hash(JSON.stringify({ type: item.type, filename: item.filename || '', summary: item.profile_summary || '', preview: item.parsed_text_preview || '', returned: item.recommendation?.returned || 0 })) !== fingerprint)].slice(0, 24);
    writeStore(STORAGE_KEYS.recommendationHistory, next);
    return next[0];
}

const API = {
    buildQuery(params = {}) {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value === null || value === undefined || value === '') return;
            query.set(key, String(value));
        });
        return query.toString();
    },

    async request(url) {
        throw new APIError(`静态页面不支持直接请求：${url}`, 501);
    },

    async login(data = {}) {
        const users = ensureUsers();
        const target = users.find(user => user.username === text(data.username));
        if (!target) throw new APIError('用户名或密码错误', 401);
        
        // 验证密码（支持加密和明文兼容）
        let passwordValid = false;
        if (target.password && target.password.includes(':')) {
            // 新格式：加密密码
            passwordValid = await PasswordCrypto.verify(String(data.password || ''), target.password);
        } else {
            // 旧格式：明文密码（兼容旧用户）
            passwordValid = target.password === String(data.password || '');
        }
        
        if (!passwordValid) throw new APIError('用户名或密码错误', 401);
        if (target.is_active === false) throw new APIError('账号已停用，请联系管理员', 403);
        
        // 如果是旧格式明文密码，自动升级为加密格式
        if (target.password && !target.password.includes(':')) {
            target.password = await PasswordCrypto.encrypt(target.password);
            saveUsers(users);
        }
        
        target.last_login_at = nowLocal();
        saveUsers(users);
        return { access_token: `jobweb-${target.id}-${Date.now()}`, token_type: 'bearer', user: buildPublicUser(target) };
    },

    async logout() {
        return { success: true, message: '已退出登录' };
    },

    async getCurrentUser() {
        const user = requireUser();
        const fresh = ensureUsers().find(item => item.id === user.id || item.username === user.username);
        if (!fresh || fresh.is_active === false) throw new APIError('当前登录信息已失效', 401);
        return buildPublicUser(fresh);
    },

    async getRoles() {
        requireUser();
        return { roles: ROLE_DEFINITIONS.map(role => ({ id: role.id, label: role.label, permissions: role.permissions.slice() })) };
    },

    async getUsers() {
        const user = requireUser();
        if (!(user.permissions || []).includes('manage_users')) throw new APIError('没有权限访问用户管理', 403);
        return ensureUsers().map(buildPublicUser);
    },

    async createUser(data = {}) {
        const user = requireUser();
        if (!(user.permissions || []).includes('manage_users')) throw new APIError('没有权限创建用户', 403);
        if (!text(data.username) || !String(data.password || '').trim()) throw new APIError('请填写用户名和密码', 400);
        const users = ensureUsers();
        if (users.some(item => item.username === text(data.username))) throw new APIError('用户名已存在', 400);
        
        // 加密密码
        const encryptedPassword = await PasswordCrypto.encrypt(String(data.password));
        
        const next = {
            id: users.reduce((max, item) => Math.max(max, Number(item.id || 0)), 0) + 1,
            username: text(data.username),
            password: encryptedPassword,
            display_name: text(data.display_name) || text(data.username),
            role: getRole(text(data.role) || 'viewer').id,
            is_active: data.is_active !== false,
            last_login_at: '',
        };
        users.push(next);
        saveUsers(users);
        return { success: true, message: '用户创建成功', user: buildPublicUser(next) };
    },

    async updateUser(id, data = {}) {
        const user = requireUser();
        if (!(user.permissions || []).includes('manage_users')) throw new APIError('没有权限更新用户', 403);
        const users = ensureUsers();
        const target = users.find(item => Number(item.id) === Number(id));
        if (!target) throw new APIError('用户不存在', 404);
        if (text(data.display_name)) target.display_name = text(data.display_name);
        if (text(data.role)) target.role = getRole(text(data.role)).id;
        if (typeof data.is_active === 'boolean') target.is_active = data.is_active;
        saveUsers(users);
        return { success: true, message: '用户更新成功', user: buildPublicUser(target) };
    },

    async resetUserPassword(id, data = {}) {
        const user = requireUser();
        if (!(user.permissions || []).includes('manage_users')) throw new APIError('没有权限重置密码', 403);
        const users = ensureUsers();
        const target = users.find(item => Number(item.id) === Number(id));
        if (!target) throw new APIError('用户不存在', 404);
        if (!String(data.password || '').trim()) throw new APIError('请提供新密码', 400);
        
        // 加密新密码
        target.password = await PasswordCrypto.encrypt(String(data.password));
        saveUsers(users);
        return { success: true, message: '密码已重置' };
    },

    async deleteUser(id) {
        const user = requireUser();
        if (!(user.permissions || []).includes('manage_users')) throw new APIError('没有权限删除用户', 403);
        const users = ensureUsers();
        const target = users.find(item => Number(item.id) === Number(id));
        if (!target) throw new APIError('用户不存在', 404);
        if (target.username === 'admin') throw new APIError('默认管理员不能删除', 400);
        saveUsers(users.filter(item => Number(item.id) !== Number(id)));
        return { success: true, message: '用户已删除' };
    },

    async getJobs(params = {}) {
        requireUser();
        return paginate(filteredJobs(params), params.page || 1, params.page_size || params.pageSize || 20);
    },

    async getJob(id) {
        requireUser();
        const job = allJobs().find(item => Number(item.id) === Number(id));
        if (!job) throw new APIError('岗位不存在', 404);
        return clone(job);
    },

    async searchJobs(keyword, params = {}) {
        return this.getJobs({ ...params, keyword });
    },

    async getFavorites(params = {}) {
        requireUser();
        return paginate(filteredJobs(params).filter(job => job.is_favorite), params.page || 1, params.page_size || params.pageSize || 20);
    },

    async toggleFavorite(id) {
        requireUser();
        const favorites = favoritesSet();
        const current = favorites.has(Number(id));
        if (current) favorites.delete(Number(id)); else favorites.add(Number(id));
        saveFavorites(favorites);
        return { success: true, is_favorite: !current, message: current ? '已取消收藏' : '已加入收藏' };
    },

    async getFilterOptions() {
        requireUser();
        return filterOptions();
    },

    async getLocationTree() {
        requireUser();
        const provinceMap = new Map();
        allJobs().forEach(job => {
            const province = (LOCATION_KEYWORDS.find(item => String(job.location || '').includes(item)) || '其他').replace(/^(北京|上海|天津|重庆)$/, '$1市');
            const key = province || '其他';
            const item = provinceMap.get(key) || new Map();
            item.set(job.location, (item.get(job.location) || 0) + 1);
            provinceMap.set(key, item);
        });
        return Array.from(provinceMap.entries()).map(([province, cities]) => ({
            province, count: Array.from(cities.values()).reduce((sum, value) => sum + value, 0),
            cities: Array.from(cities.entries()).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))
        }));
    },

    async getJobFacets(params = {}) {
        requireUser();
        const jobs = filteredJobs(params);
        return { locations: buckets(jobs, 'location'), job_types: buckets(jobs, 'job_type'), industries: buckets(jobs, 'industry'), sources: buckets(jobs, 'source'), categories: buckets(jobs, 'category'), educations: buckets(jobs, 'education') };
    },

    async getSimilarJobs(id, limit = 6) {
        requireUser();
        const target = await this.getJob(id);
        return allJobs().filter(job => Number(job.id) !== Number(id)).map(job => {
            let score = 0;
            if (job.location && job.location === target.location) score += 18;
            if (job.category && job.category === target.category) score += 16;
            if (job.industry && job.industry === target.industry) score += 14;
            if (job.job_type && job.job_type === target.job_type) score += 10;
            if (job.education && job.education === target.education) score += 8;
            return { job, score };
        }).sort((a, b) => b.score - a.score || jobTimestamp(b.job) - jobTimestamp(a.job)).slice(0, Number(limit || 6)).map(item => item.job);
    },

    async updateJobProgress(id, data = {}) {
        requireUser();
        const store = progressStore();
        store[String(id)] = { status: text(data.status) || '未投递', notes: String(data.notes || ''), updated_at: nowLocal() };
        writeStore(STORAGE_KEYS.progress, store);
        const timeline = timelineStore();
        const list = Array.isArray(timeline[String(id)]) ? timeline[String(id)] : [];
        list.unshift({ id: `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, event_type: 'status_update', title: `进度更新为 ${store[String(id)].status}`, notes: store[String(id)].notes, created_at: store[String(id)].updated_at });
        timeline[String(id)] = list.slice(0, 30);
        writeStore(STORAGE_KEYS.timeline, timeline);
        return { success: true, message: '求职进度已更新', data: store[String(id)] };
    },

    async getProgressSummary() {
        requireUser();
        const counter = new Map();
        Object.values(progressStore()).forEach(item => counter.set(text(item.status) || '未投递', (counter.get(text(item.status) || '未投递') || 0) + 1));
        return Array.from(counter.entries()).map(([status, count]) => ({ status, count }));
    },

    async getJobTimeline(id) {
        requireUser();
        return Array.isArray(timelineStore()[String(id)]) ? timelineStore()[String(id)] : [];
    },

    async addJobTimeline(id, data = {}) {
        requireUser();
        const timeline = timelineStore();
        const list = Array.isArray(timeline[String(id)]) ? timeline[String(id)] : [];
        const entry = { id: `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, event_type: text(data.event_type) || 'manual', title: text(data.title) || '手动记录', notes: String(data.notes || ''), created_at: nowLocal() };
        list.unshift(entry);
        timeline[String(id)] = list.slice(0, 30);
        writeStore(STORAGE_KEYS.timeline, timeline);
        return { success: true, message: '时间线已添加', data: entry };
    },

    async analyzeJob(id, data = {}) {
        requireUser();
        const job = await this.getJob(id);
        const result = await runAiTextScene('岗位分析', {
            logLabel: 'AI 岗位分析失败',
            systemPrompt: '你是一名金融岗位分析助手。请输出结构化 Markdown，说明岗位适合什么人、亮点、风险和投递建议。',
            userPrompt: `岗位信息：${JSON.stringify(job, null, 2)}\n\n用户追问：${data.question || '请给出这份岗位的整体推荐分析。'}`,
            history: data.history || [],
            callOptions: { scope: 'job-analysis', cacheKey: { id, question: data.question || '', history: data.history || [] }, timeout: 45, stream: false, maxInputChars: 10000 },
        });
        return { answer: result.answer, model: result.model };
    },

    async getJobMatchReport(id, profile = {}) {
        requireUser();
        const job = await this.getJob(id);
        const scored = scoreJob(job, profile || {});
        const result = await runAiTextScene('岗位匹配报告', {
            logLabel: 'AI 岗位匹配报告失败',
            systemPrompt: '你是金融求职顾问。请围绕岗位与候选人画像，输出结构化匹配报告，包含匹配亮点、风险点、建议投递顺序。',
            userPrompt: `候选人画像：${JSON.stringify(profile, null, 2)}\n\n岗位信息：${JSON.stringify(job, null, 2)}\n\n请输出 Markdown 报告。`,
            history: [],
            callOptions: { scope: 'match-report', cacheKey: { id, profile }, timeout: 45, stream: false, maxInputChars: 10000 },
        });
        return { report: result.answer, model: result.model };
    },

    async generateInterviewQuestions(id) {
        requireUser();
        const job = await this.getJob(id);
        const result = await runAiTextScene('面试问题生成', {
            logLabel: 'AI 面试题生成失败',
            systemPrompt: '你是一名面试教练。请基于岗位信息生成面试题与回答思路，使用 Markdown。',
            userPrompt: `岗位信息：${JSON.stringify(job, null, 2)}\n\n请输出 6-8 个面试问题，并给出简短回答方向。`,
            history: [],
            callOptions: { scope: 'interview-questions', cacheKey: { id, title: job.title }, timeout: 45, stream: false, maxInputChars: 9000 },
        });
        return { data: { questions: result.answer }, model: result.model };
    },

    async getInterviewQuestions(id) {
        return this.generateInterviewQuestions(id);
    },

    async getRecommendations(data = {}) {
        requireUser();
        const profile = {
            keywords: unique(data.keywords || []),
            preferred_locations: unique(data.preferred_locations || []),
            preferred_job_types: unique(data.preferred_job_types || []),
            preferred_industries: unique(data.preferred_industries || []),
            education: text(data.education),
            experience: text(data.experience),
            target_companies: unique(data.target_companies || []),
            schools: unique(data.schools || []),
            majors: unique(data.majors || []),
            skills: unique(data.skills || []),
            certifications: unique(data.certifications || []),
            strengths: unique(data.strengths || []),
            additional_notes: text(data.additional_notes),
        };
        const maxResults = Math.max(1, Math.min(Number(data.max_results || 12), 20));
        const jobs = allJobs();
        const recallLimit = Math.min(Math.max(maxResults + 4, 8), 14);
        const recalled = jobs
            .map(job => ({ ...scoreJob(job, profile), job }))
            .filter(item => item.score > 0 || !(profile.keywords || []).length)
            .sort((a, b) => b.score - a.score || jobTimestamp(b.job) - jobTimestamp(a.job))
            .slice(0, recallLimit);

        let analysis = '### AI 推荐分析\n- 暂无可分析的岗位结果。';
        let model = null;
        const usedAiSummary = true;
        try {
            const aiProfile = compactProfileForAi(profile);
            const candidates = recalled.map(item => ({
                id: item.job.id,
                title: item.job.title || '',
                company: item.job.company || '',
                location: item.job.location || '',
                recall_score: Number(item.score || 0),
                recall_tier: item.recommendation_tier || '',
                education: item.job.education || '',
                job_type: item.job.job_type || '',
                industry: item.job.industry || '',
                source: item.job.source || '',
                requirements_excerpt: cleanText(item.job.requirements || item.job.description || '').slice(0, 84),
            }));

            const { parsed, model: recommendationModel } = await runAiJsonScene('推荐分析', {
                logLabel: 'AI 推荐分析失败',
                systemPrompt: '你是一名金融求职顾问。你必须只输出 JSON，不要输出 Markdown 代码块、不要输出解释文本。',
                userPrompt: `任务：基于候选人画像对候选岗位排序并给出推荐。\n候选人画像：${JSON.stringify(aiProfile)}\n候选岗位：${JSON.stringify(candidates)}\n\n只返回JSON：{"analysis_markdown":"...","recommendations":[{"id":"岗位id","rank_score":0-100,"recommendation_tier":"冲刺岗/匹配岗/保底岗","reasons":["..."],"summary_markdown":"..."}]}\n\n约束：recommendations恰好${maxResults}条；id必须来自候选岗位；reasons每条2-3点；summary_markdown简洁。`,
                history: [],
                schemaHint: '{"analysis_markdown":"...","recommendations":[{"id":"岗位id","rank_score":0-100,"recommendation_tier":"冲刺岗/匹配岗/保底岗","reasons":["..."],"summary_markdown":"..."}]}',
                callOptions: {
                    scope: 'recommendations',
                    cacheKey: {
                        profile_summary: buildProfileSummary(aiProfile),
                        recallIds: candidates.map(item => item.id),
                        maxResults,
                    },
                    timeout: 50,
                    maxTokens: 480,
                    stream: false,
                    maxInputChars: 9000,
                },
            });

            const byId = new Map(recalled.map(item => [String(item.job.id), item]));
            const ranked = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
            const aiRecommendations = ranked
                .map(entry => {
                    const key = String(entry?.id ?? '');
                    const base = byId.get(key);
                    if (!base) return null;
                    const aiReasons = Array.isArray(entry.reasons) ? unique(entry.reasons.map(reason => text(reason)).filter(Boolean)).slice(0, 6) : [];
                    const summaryMarkdown = text(entry.summary_markdown);
                    if (!summaryMarkdown) return null;
                    return {
                        ...base,
                        score: Math.max(0, Math.min(100, Number(entry.rank_score ?? base.score ?? 0))),
                        recommendation_tier: text(entry.recommendation_tier) || base.recommendation_tier,
                        reasons: aiReasons.length ? aiReasons : base.reasons,
                        summary_markdown: summaryMarkdown,
                        summary_model: recommendationModel || null,
                        score_breakdown: {},
                    };
                })
                .filter(Boolean)
                .slice(0, maxResults);

            if (!aiRecommendations.length) {
                throw new Error('AI 未返回有效推荐岗位');
            }

            const analysisMarkdown = text(parsed.analysis_markdown);
            if (!analysisMarkdown) {
                throw new Error('AI 未返回分析摘要');
            }

            analysis = analysisMarkdown;
            model = recommendationModel || null;
            const payload = { total_considered: jobs.length, returned: aiRecommendations.length, profile_summary: buildProfileSummary(profile), analysis_summary: analysis, model, used_ai_summary: usedAiSummary, ai_error: null, resume_diagnostic: null, resume_diagnostic_markdown: '', recommendations: aiRecommendations };
            if (data.save_to_server_history !== false) {
                upsertHistory({ type: 'recommendation', profile_summary: payload.profile_summary, profile, recommendation: payload });
            }
            return payload;
        } catch (error) {
            const errorMessage = String(error?.message || '');
            if (/返回格式无效|JSON|超时|timeout|file:\/\//i.test(errorMessage)) {
                console.warn('AI 推荐分析JSON异常，已降级为规则推荐:', errorMessage);
                const fallbackRecommendations = recalled
                    .slice(0, maxResults)
                    .map(item => ({
                        ...item,
                        summary_markdown: recommendationSummary(item),
                        summary_model: null,
                        score_breakdown: item.score_breakdown || {},
                    }));
                const fallbackAnalysis = [
                    '### AI 推荐分析（降级）',
                    '- 本次 AI 调用超时或返回格式异常，已自动切换为规则匹配推荐结果。',
                    '- 若你是直接双击打开 HTML（file://），请改为本地 HTTP 方式访问后重试。',
                ].join('\n');
                const payload = {
                    total_considered: jobs.length,
                    returned: fallbackRecommendations.length,
                    profile_summary: buildProfileSummary(profile),
                    analysis_summary: fallbackAnalysis,
                    model: null,
                    used_ai_summary: false,
                    ai_error: errorMessage,
                    resume_diagnostic: null,
                    resume_diagnostic_markdown: '',
                    recommendations: fallbackRecommendations,
                };
                if (data.save_to_server_history !== false) {
                    upsertHistory({ type: 'recommendation', profile_summary: payload.profile_summary, profile, recommendation: payload });
                }
                return payload;
            }
            if (error instanceof APIError) throw error;
            console.warn('AI 推荐分析失败:', error);
            throw createAiApiError(error);
        }
    },

    async getResumeDiagnostic(data = {}) {
        requireUser();
        const file = data.resume_file;
        if (!file) {
            throw new APIError('请先上传简历原件，再执行 AI 简历诊断。', 400);
        }

        const extraction = await extractResumeText(file);
        const resumeText = normalizeResumeText(extraction?.text || '');
        if (!resumeText) {
            throw new APIError('未能从简历中提取到可用文本，请更换可读取的原件后重试。', 400);
        }

        const profile = (data.profile && Object.keys(data.profile).length)
            ? data.profile
            : buildResumeProfile(resumeText);
        const targetJobs = data.target_jobs || [];
        const clippedResume = resumeText.slice(0, 12000);
        const extractionNotice = extraction?.notice
            || (!isUsefulResumeText(resumeText) ? '已提取到部分文本，但内容较短，诊断可能不完整。' : '');

        try {
            const result = await runAiTextScene('AI 简历诊断', {
                logLabel: 'AI 简历诊断失败',
                systemPrompt: '你是一名中文简历诊断顾问。请输出结构化 Markdown，必须包含：总体评估、优势亮点（3-5条）、主要风险（3-5条）、优先修改清单（按优先级排序）、面向目标岗位的改写示例。内容要可直接执行。',
                userPrompt: `候选人画像：${JSON.stringify(profile || {}, null, 2)}\n\n目标岗位：${JSON.stringify(targetJobs, null, 2)}\n\n简历原文（可能已做OCR提取）：\n${clippedResume}`,
                history: [],
                callOptions: {
                    scope: 'resume-diagnostic-ai',
                    cacheKey: {
                        filename: file.name || 'resume',
                        file_size: file.size || 0,
                        file_last_modified: file.lastModified || 0,
                        profile_summary: buildProfileSummary(profile),
                        target_titles: targetJobs.map(job => job?.title || '').slice(0, 6),
                    },
                    timeout: 55,
                    stream: false,
                    maxInputChars: 11000,
                },
            });
            return {
                answer: result.answer,
                model: result.model,
                extraction_method: extraction?.method || 'text',
                extraction_notice: extractionNotice,
            };
        } catch (error) {
            if (error instanceof APIError) throw error;
            console.warn('AI 简历诊断失败:', error);
            throw createAiApiError(error);
        }
    },

    async getRecommendationChat(data = {}) {
        requireUser();
        const result = await runAiTextScene('追问回答', {
            logLabel: 'AI 追问回答失败',
            systemPrompt: '你是一名金融求职顾问，请延续上下文，用简洁、可执行的 Markdown 回答用户追问。',
            userPrompt: `用户画像：${JSON.stringify(data.profile || {}, null, 2)}\n\n候选岗位：${JSON.stringify(data.recommendations || [], null, 2)}\n\n问题：${data.question || ''}`,
            history: data.history || [],
            callOptions: { scope: 'recommendation-chat', cacheKey: { profile: data.profile, question: data.question, jobs: (data.recommendations || []).map(job => job.id || job.title) }, timeout: 45, stream: false, maxInputChars: 10000 },
        });
        return { answer: result.answer, model: result.model };
    },

    async getResumeAdvice(data = {}) {
        requireUser();
        const result = await runAiTextScene('简历建议', {
            logLabel: 'AI 改简历建议失败',
            systemPrompt: '你是一名简历优化顾问。请基于候选人画像和目标岗位输出具体可执行的简历改写建议，使用 Markdown。',
            userPrompt: `候选人画像：${JSON.stringify(data.profile || {}, null, 2)}\n\n目标岗位：${JSON.stringify(data.target_jobs || [], null, 2)}`,
            history: [],
            callOptions: { scope: 'resume-advice', cacheKey: { profile: data.profile, targets: (data.target_jobs || []).map(job => job.id || job.title) }, timeout: 45, stream: false, maxInputChars: 10000 },
        });
        return { answer: result.answer, model: result.model };
    },

    async getDeliveryAssistant(data = {}) {
        requireUser();
        const result = await runAiTextScene('投递助手', {
            logLabel: 'AI 投递助手失败',
            systemPrompt: '你是一名投递助手。请生成适合中文求职场景的自我介绍、邮件正文建议和投递重点，使用 Markdown。',
            userPrompt: `候选人画像：${JSON.stringify(data.profile || {}, null, 2)}\n\n目标岗位：${JSON.stringify(data.job || {}, null, 2)}`,
            history: [],
            callOptions: { scope: 'delivery-assistant', cacheKey: { profile: data.profile, jobId: data.job?.id }, timeout: 45, stream: false, maxInputChars: 10000 },
        });
        return { answer: result.answer, model: result.model };
    },

    async uploadResume(file, options = {}) {
        requireUser();
        if (!file) throw new APIError('请先选择简历文件', 400);
        const extraction = await extractResumeText(file);
        const resumeText = normalizeResumeText(extraction?.text || '');
        if (!resumeText) {
            throw new APIError('未能从简历中提取到可用文本，请优先上传可复制文本的 PDF / DOCX，或改用图片 / 扫描件 OCR 版本。', 400);
        }
        const profile = buildResumeProfile(resumeText);
        const diagnostic = resumeDiagnostic(profile, resumeText);
        const extractionNotice = extraction?.notice
            || (!isUsefulResumeText(resumeText) ? '已提取到部分文本，但内容较短，建议补充手动信息以提高推荐精度。' : '');
        if (options.saveToServerHistory !== false) {
            upsertHistory({
                type: 'resume_upload',
                filename: file.name,
                saved_file: '浏览器本地存储',
                parsed_text_preview: sanitizePrivacy(resumeText).slice(0, 800),
                profile_summary: buildProfileSummary(profile),
                profile,
                extraction_method: extraction?.method || 'text',
                extraction_notice: extractionNotice,
                recommendation: {
                    resume_diagnostic_markdown: diagnostic.markdown,
                    resume_diagnostic: {
                        score: diagnostic.score,
                        highlights: diagnostic.highlights,
                        risks: diagnostic.risks,
                        suggestions: diagnostic.suggestions,
                    },
                },
            });
        }
        return {
            filename: file.name,
            saved_path: '浏览器本地存储',
            preview_text: sanitizePrivacy(resumeText).slice(0, 800),
            profile,
            extraction_method: extraction?.method || 'text',
            extraction_notice: extractionNotice,
            saved_to_server_history: options.saveToServerHistory !== false,
            resume_diagnostic: {
                score: diagnostic.score,
                highlights: diagnostic.highlights,
                risks: diagnostic.risks,
                suggestions: diagnostic.suggestions,
            },
            resume_diagnostic_markdown: diagnostic.markdown,
        };
    },

    async getRecommendationHistory(limit = 10) {
        requireUser();
        return readStore(STORAGE_KEYS.recommendationHistory, []).slice(0, Number(limit || 10));
    },

    async clearRecommendationHistory() {
        requireUser();
        writeStore(STORAGE_KEYS.recommendationHistory, []);
        return { success: true, message: '记录已清空' };
    },

    async deleteRecommendationHistory(id) {
        requireUser();
        writeStore(STORAGE_KEYS.recommendationHistory, readStore(STORAGE_KEYS.recommendationHistory, []).filter(item => String(item.id) !== String(id)));
        return { success: true, message: '记录已删除' };
    },

    async getSystemStatus() {
        requireUser();
        const stats = aiStatsStore();
        const diagnostics = {};
        buckets(allJobs(), 'source').forEach(item => {
            const meta = SOURCE_QUALITY_MAP[item.label] || { tier: 'B', frequency: '中频', weight: 0.8, reason: '按本地快照估算来源质量。' };
            diagnostics[item.label] = { runs: 1, fetched: item.count, saved: item.count, duplicates: 0, failed: 0, write_failures: 0, tier: meta.tier, frequency: meta.frequency, quality_weight: meta.weight, reason: meta.reason };
        });
        const successRate = Object.keys(diagnostics).length ? 100 : 0;
        const timeoutRate = stats.requests > 0 ? Number(((stats.timeouts / stats.requests) * 100).toFixed(1)) : 0;
        const cacheHitRate = stats.requests > 0 ? Number(((stats.cache_hits / stats.requests) * 100).toFixed(1)) : 0;
        return {
            app: { name: snapshot().meta?.app_name || 'FinIntern Hub', version: snapshot().meta?.version || '3.9.2' },
            database: { total_jobs: overview().total_jobs, snapshot_generated_at: snapshot().meta?.generated_at || '' },
            today_jobs: overview().today_jobs,
            crawler_success_rate: successRate,
            ai_runtime: { daily_tokens: stats.daily_tokens, daily_budget: Number(configStore().ai.daily_token_budget || stats.daily_budget || 300000), timeout_rate: timeoutRate, cache_hit_rate: cacheHitRate, model_switches: stats.model_switches, by_model: stats.by_model, recent_failures: stats.recent_failures || [] },
            progress_summary: await this.getProgressSummary(),
            task_center: [
                { name: '岗位快照同步', status: 'healthy', detail: `当前加载 ${overview().total_jobs} 条本地岗位快照` },
                { name: 'AI 推荐分析', status: (stats.recent_failures || []).length ? 'warning' : 'healthy', detail: `今日估算 ${stats.daily_tokens} tokens` },
                { name: '本地历史记录', status: 'healthy', detail: `已保存 ${readStore(STORAGE_KEYS.recommendationHistory, []).length} 条记录` },
                { name: '页面模式', status: 'healthy', detail: '当前为静态网页直读本地快照模式' },
            ],
            recent_errors: (stats.recent_failures || []).map(item => ({ source: 'AI', time: item.time, status: 'ai_failure', message: item.message })),
            crawler_diagnostics: diagnostics,
            maintenance: readStore(STORAGE_KEYS.maintenance, { last_cleaned_at: '', cleaned_count: 0 }),
        };
    },

    async getSystemConfig() {
        requireUser();
        return configStore();
    },

    async updateSystemConfig(data = {}) {
        requireUser();
        const config = configStore();
        const parseModelList = (value, fallback = []) => {
            if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
            if (typeof value === 'string') {
                return value.split(/[\n,，]/).map(item => item.trim()).filter(Boolean);
            }
            return Array.isArray(fallback) ? fallback.slice() : [];
        };
        config.app.debug = Boolean(data.debug);
        config.crawler.max_concurrent = Number(data.crawler_max_concurrent || config.crawler.max_concurrent || 0);
        config.crawler.request_timeout = Number(data.crawler_request_timeout || config.crawler.request_timeout || 0);
        config.crawler.retry_attempts = Number(data.crawler_retry_attempts || config.crawler.retry_attempts || 0);
        config.crawler.headless = Boolean(data.crawler_headless);
        config.ai.api_key = String(data.siliconflow_api_key ?? config.ai.api_key ?? '').trim();
        config.ai.primary_model = String(data.siliconflow_primary_model || config.ai.primary_model || config.ai.model || '').trim();
        config.ai.model = config.ai.primary_model;
        config.ai.fallback_models = parseModelList(data.siliconflow_fallback_models, config.ai.fallback_models || []);
        config.ai.timeout = Number(data.siliconflow_timeout || config.ai.timeout || 0);
        config.ai.max_output_tokens = Number(data.siliconflow_max_output_tokens || config.ai.max_output_tokens || 0);
        config.ai.daily_token_budget = Number(data.siliconflow_daily_token_budget || config.ai.daily_token_budget || 0);
        config.runtime_overrides = { ...config.runtime_overrides, ...data };
        saveConfig(config);
        const stats = aiStatsStore();
        stats.daily_budget = config.ai.daily_token_budget;
        saveAiStats(stats);
        return { success: true, message: '配置已保存', data: config };
    },

    async cleanHistoricalData(limit = 500) {
        requireUser();
        const jobs = allJobs().slice(0, Number(limit || 500));
        const cleaned = jobs.filter(job => /温馨提示|分享至|收藏|职位列表|投递简历/.test(`${job.description || ''} ${job.requirements || ''}`)).length;
        writeStore(STORAGE_KEYS.maintenance, { last_cleaned_at: nowLocal(), cleaned_count: cleaned });
        return { success: true, message: `已模拟执行历史岗位清洗，共识别 ${cleaned} 条需要重点整理的内容。` };
    },

    async getSubscriptions() {
        requireUser();
        return readStore(STORAGE_KEYS.subscriptions, []);
    },

    async saveSubscription(data = {}) {
        requireUser();
        const items = readStore(STORAGE_KEYS.subscriptions, []);
        items.unshift({ id: Date.now(), name: text(data.name), keyword: text(data.keyword), locations: unique(data.locations || []), industries: unique(data.industries || []), job_types: unique(data.job_types || []), education: text(data.education), enabled: data.enabled !== false, created_at: nowLocal() });
        writeStore(STORAGE_KEYS.subscriptions, items.slice(0, 30));
        return { success: true, message: '订阅已保存' };
    },

    async deleteSubscription(id) {
        requireUser();
        writeStore(STORAGE_KEYS.subscriptions, readStore(STORAGE_KEYS.subscriptions, []).filter(item => Number(item.id) !== Number(id)));
        return { success: true, message: '订阅已删除' };
    },

    async previewSubscription(id) {
        requireUser();
        const sub = readStore(STORAGE_KEYS.subscriptions, []).find(item => Number(item.id) === Number(id));
        if (!sub) return [];
        return filteredJobs({ keyword: sub.keyword, location: sub.locations?.[0] || '', industry: sub.industries?.[0] || '', job_type: sub.job_types?.[0] || '', education: sub.education }).slice(0, 8);
    },

    async getCrawlerStatus() {
        requireUser();
        return { is_running: false, status: 'disabled', progress: 0, message: '当前网页版不执行真实爬虫任务，请使用桌面服务端版本采集数据。', current_source: '', elapsed_seconds: 0, task_id: '' };
    },

    async startCrawler() {
        requireUser();
        const logs = readStore(STORAGE_KEYS.crawlerLogs, []);
        logs.unshift({ timestamp: nowIso(), level: 'WARNING', source: 'crawler', stage: '禁止执行', message: '当前网页版不支持直接启动爬虫，请回到桌面服务端版本执行采集。' });
        writeStore(STORAGE_KEYS.crawlerLogs, logs.slice(0, 160));
        return { success: false, message: '当前网页版不支持在线采集，请使用桌面服务端版本。', task_id: '' };
    },

    async stopCrawler() {
        requireUser();
        return { success: true, message: '当前没有运行中的采集任务。' };
    },

    async getCrawlerLogs(limit = 50) {
        requireUser();
        const logs = readStore(STORAGE_KEYS.crawlerLogs, [{ timestamp: nowIso(), level: 'INFO', source: 'jobweb', stage: '初始化', message: '当前网页版已迁移主站页面；数据采集页仅保留监控外观，不执行真实爬虫任务。' }]);
        return logs.slice(0, Number(limit || 50));
    },

    async getCrawlerSources() {
        requireUser();
        return buckets(allJobs(), 'source').map(item => ({ name: item.label, url: '', enabled: true, count: item.count }));
    },

    async getStatsOverview() {
        requireUser();
        return { overview: overview(), hot_keywords: buckets(allJobs(), 'category').slice(0, 10).map(item => ({ keyword: item.label, count: item.count })) };
    },

    async getSourceStats() {
        requireUser();
        const jobs = allJobs();
        const total = jobs.length || 1;
        return buckets(jobs, 'source').map(item => ({ source: item.label, count: item.count, percentage: Number(((item.count / total) * 100).toFixed(1)) }));
    },

    async getTrends(days = 7) {
        requireUser();
        const counter = new Map();
        allJobs().forEach(job => {
            const key = String(job.publish_date || job.created_at || '').slice(0, 10);
            if (key) counter.set(key, (counter.get(key) || 0) + 1);
        });
        const result = [];
        for (let i = Number(days || 7) - 1; i >= 0; i -= 1) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const key = date.toISOString().slice(0, 10);
            result.push({ date: key, count: counter.get(key) || 0 });
        }
        return { dates: result.map(item => item.date), counts: result.map(item => item.count) };
    },

    startDataUpdateListener(onUpdate, interval = 5000) {
        let last = overview().total_jobs;
        const timer = setInterval(() => {
            const current = overview().total_jobs;
            if (current > last) onUpdate(current - last, current);
            last = current;
        }, interval);
        return () => clearInterval(timer);
    },

    async batch(requests) {
        return Promise.all(requests);
    },

    async withRetry(requestFn, maxRetries = 3, delay = 1000) {
        let lastError;
        for (let i = 0; i < maxRetries; i += 1) {
            try {
                return await requestFn();
            } catch (error) {
                lastError = error;
                if (error instanceof APIError && error.status >= 400 && error.status < 500) throw error;
                if (i === maxRetries - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
            }
        }
        throw lastError;
    },
};

window.API = API;
window.APIError = APIError;
window.DataLoader = DataLoader;  // 暴露数据加载器
window.JobCache = JobCache;  // 暴露缓存管理器

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { API, APIError, DataLoader, JobCache };
}
