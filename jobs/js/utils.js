/**
 * FinIntern Hub - 公共工具函数库
 * 提供DOM操作、日期格式化、防抖节流、本地存储、URL参数处理等常用功能
 */

// ==================== DOM操作工具 ====================

/**
 * 简化querySelector
 * @param {string} selector - CSS选择器
 * @param {Element} parent - 父元素（默认为document）
 * @returns {Element|null}
 */
function qs(selector, parent = document) {
    return parent.querySelector(selector);
}

/**
 * 简化querySelectorAll
 * @param {string} selector - CSS选择器
 * @param {Element} parent - 父元素（默认为document）
 * @returns {NodeList}
 */
function qsa(selector, parent = document) {
    return parent.querySelectorAll(selector);
}

/**
 * 创建带属性和子元素的DOM元素
 * @param {string} tag - 标签名
 * @param {Object} attrs - 属性对象
 * @param {string|Element|Array} children - 子元素或文本内容
 * @returns {Element}
 */
function createElement(tag, attrs = {}, children = null) {
    const el = document.createElement(tag);
    
    // 设置属性
    Object.entries(attrs).forEach(([key, value]) => {
        if (key === 'className') {
            el.className = value;
        } else if (key === 'dataset') {
            Object.entries(value).forEach(([dataKey, dataValue]) => {
                el.dataset[dataKey] = dataValue;
            });
        } else if (key.startsWith('on') && typeof value === 'function') {
            el.addEventListener(key.slice(2).toLowerCase(), value);
        } else {
            el.setAttribute(key, value);
        }
    });
    
    // 添加子元素
    if (children) {
        if (Array.isArray(children)) {
            children.forEach(child => appendChild(el, child));
        } else {
            appendChild(el, children);
        }
    }
    
    return el;
}

/**
 * 辅助函数：添加子元素
 * @param {Element} parent - 父元素
 * @param {string|Element} child - 子元素
 */
function appendChild(parent, child) {
    if (typeof child === 'string') {
        parent.appendChild(document.createTextNode(child));
    } else if (child instanceof Element) {
        parent.appendChild(child);
    }
}

/**
 * 安全地插入HTML（使用模板元素）
 * @param {Element} container - 目标容器
 * @param {string} html - HTML字符串
 * @param {string} position - 插入位置 ('beforebegin', 'afterbegin', 'beforeend', 'afterend')
 */
function insertHTML(container, html, position = 'beforeend') {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    const elements = Array.from(template.content.children);
    
    switch (position) {
        case 'beforebegin':
            elements.forEach(el => container.parentNode.insertBefore(el, container));
            break;
        case 'afterbegin':
            elements.reverse().forEach(el => container.insertBefore(el, container.firstChild));
            break;
        case 'beforeend':
            elements.forEach(el => container.appendChild(el));
            break;
        case 'afterend':
            elements.reverse().forEach(el => container.parentNode.insertBefore(el, container.nextSibling));
            break;
        default:
            throw new Error(`Invalid position: ${position}`);
    }
    
    return elements;
}

// ==================== 日期格式化工具 ====================

/**
 * 格式化日期
 * @param {Date|string|number} date - 日期对象、字符串或时间戳
 * @param {string} format - 格式化模板 (YYYY, MM, DD, HH, mm, ss)
 * @returns {string}
 */
function formatDate(date, format = 'YYYY-MM-DD') {
    const d = date instanceof Date ? date : new Date(date);
    
    if (isNaN(d.getTime())) {
        return '';
    }
    
    const pad = (n) => String(n).padStart(2, '0');
    
    const tokens = {
        YYYY: d.getFullYear(),
        MM: pad(d.getMonth() + 1),
        DD: pad(d.getDate()),
        HH: pad(d.getHours()),
        mm: pad(d.getMinutes()),
        ss: pad(d.getSeconds())
    };
    
    return format.replace(/YYYY|MM|DD|HH|mm|ss/g, match => tokens[match]);
}

/**
 * 获取相对时间描述
 * @param {Date|string|number} date - 日期
 * @returns {string}
 */
function getRelativeTime(date) {
    const d = date instanceof Date ? date : new Date(date);
    const now = new Date();
    const diff = now - d;
    
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const week = 7 * day;
    const month = 30 * day;
    const year = 365 * day;
    
    if (diff < minute) return '刚刚';
    if (diff < hour) return `${Math.floor(diff / minute)}分钟前`;
    if (diff < day) return `${Math.floor(diff / hour)}小时前`;
    if (diff < week) return `${Math.floor(diff / day)}天前`;
    if (diff < month) return `${Math.floor(diff / week)}周前`;
    if (diff < year) return `${Math.floor(diff / month)}个月前`;
    return `${Math.floor(diff / year)}年前`;
}

/**
 * 解析日期字符串为Date对象
 * @param {string} dateStr - 日期字符串
 * @returns {Date|null}
 */
function parseDate(dateStr) {
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
}

// ==================== 防抖/节流函数 ====================

/**
 * 防抖函数 - 延迟执行，如果在延迟期间再次调用则重新计时
 * @param {Function} fn - 要执行的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @param {boolean} immediate - 是否立即执行
 * @returns {Function}
 */
function debounce(fn, delay = 300, immediate = false) {
    let timer = null;
    
    return function(...args) {
        const callNow = immediate && !timer;
        
        clearTimeout(timer);
        
        timer = setTimeout(() => {
            timer = null;
            if (!immediate) {
                fn.apply(this, args);
            }
        }, delay);
        
        if (callNow) {
            fn.apply(this, args);
        }
    };
}

/**
 * 节流函数 - 限制函数在一定时间内只能执行一次
 * @param {Function} fn - 要执行的函数
 * @param {number} limit - 限制时间（毫秒）
 * @param {boolean} trailing - 是否在延迟结束后执行
 * @returns {Function}
 */
function throttle(fn, limit = 300, trailing = true) {
    let inThrottle = false;
    let lastArgs = null;
    let lastThis = null;
    
    return function(...args) {
        if (!inThrottle) {
            fn.apply(this, args);
            inThrottle = true;
            
            setTimeout(() => {
                inThrottle = false;
                if (trailing && lastArgs) {
                    fn.apply(lastThis, lastArgs);
                    lastArgs = lastThis = null;
                }
            }, limit);
        } else if (trailing) {
            lastArgs = args;
            lastThis = this;
        }
    };
}

// ==================== 本地存储封装 ====================

/**
 * 本地存储管理器 - 支持JSON序列化
 */
const Storage = {
    /**
     * 设置存储项
     * @param {string} key - 键名
     * @param {*} value - 值（任意类型）
     * @param {number} expires - 过期时间（毫秒，可选）
     */
    set(key, value, expires = null) {
        try {
            const data = {
                value,
                timestamp: Date.now(),
                expires: expires ? Date.now() + expires : null
            };
            localStorage.setItem(key, JSON.stringify(data));
            return true;
        } catch (e) {
            console.error('Storage set error:', e);
            return false;
        }
    },
    
    /**
     * 获取存储项
     * @param {string} key - 键名
     * @param {*} defaultValue - 默认值
     * @returns {*}
     */
    get(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            if (!item) return defaultValue;
            
            const data = JSON.parse(item);
            
            // 检查是否过期
            if (data.expires && Date.now() > data.expires) {
                this.remove(key);
                return defaultValue;
            }
            
            return data.value;
        } catch (e) {
            console.error('Storage get error:', e);
            return defaultValue;
        }
    },
    
    /**
     * 移除存储项
     * @param {string} key - 键名
     */
    remove(key) {
        localStorage.removeItem(key);
    },
    
    /**
     * 清空所有存储
     */
    clear() {
        localStorage.clear();
    },
    
    /**
     * 获取所有键名
     * @returns {Array}
     */
    keys() {
        return Object.keys(localStorage);
    },
    
    /**
     * 检查键是否存在
     * @param {string} key - 键名
     * @returns {boolean}
     */
    has(key) {
        return localStorage.getItem(key) !== null;
    }
};

/**
 * SessionStorage 管理器
 */
const SessionStorage = {
    set(key, value) {
        try {
            sessionStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            console.error('SessionStorage set error:', e);
            return false;
        }
    },
    
    get(key, defaultValue = null) {
        try {
            const item = sessionStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (e) {
            console.error('SessionStorage get error:', e);
            return defaultValue;
        }
    },
    
    remove(key) {
        sessionStorage.removeItem(key);
    },
    
    clear() {
        sessionStorage.clear();
    }
};

// ==================== URL参数处理 ====================

/**
 * URL参数工具
 */
const URLParams = {
    /**
     * 获取URL参数值
     * @param {string} key - 参数名
     * @param {string} url - URL字符串（默认为当前URL）
     * @returns {string|null}
     */
    get(key, url = window.location.href) {
        const params = new URLSearchParams(new URL(url).search);
        return params.get(key);
    },
    
    /**
     * 获取所有URL参数
     * @param {string} url - URL字符串（默认为当前URL）
     * @returns {Object}
     */
    getAll(url = window.location.href) {
        const params = new URLSearchParams(new URL(url).search);
        const result = {};
        for (const [key, value] of params) {
            result[key] = value;
        }
        return result;
    },
    
    /**
     * 设置URL参数
     * @param {Object} params - 参数对象
     * @param {boolean} replace - 是否替换当前历史记录
     */
    set(params, replace = false) {
        const url = new URL(window.location.href);
        Object.entries(params).forEach(([key, value]) => {
            if (value === null || value === undefined) {
                url.searchParams.delete(key);
            } else {
                url.searchParams.set(key, value);
            }
        });
        
        if (replace) {
            window.history.replaceState({}, '', url);
        } else {
            window.history.pushState({}, '', url);
        }
    },
    
    /**
     * 删除URL参数
     * @param {string|Array} keys - 要删除的参数名
     * @param {boolean} replace - 是否替换当前历史记录
     */
    remove(keys, replace = false) {
        const keyArray = Array.isArray(keys) ? keys : [keys];
        const url = new URL(window.location.href);
        keyArray.forEach(key => url.searchParams.delete(key));
        
        if (replace) {
            window.history.replaceState({}, '', url);
        } else {
            window.history.pushState({}, '', url);
        }
    },
    
    /**
     * 构建带参数的URL
     * @param {string} baseUrl - 基础URL
     * @param {Object} params - 参数对象
     * @returns {string}
     */
    build(baseUrl, params = {}) {
        const url = new URL(baseUrl, window.location.origin);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== null && value !== undefined) {
                url.searchParams.set(key, value);
            }
        });
        return url.toString();
    }
};

// ==================== 表单序列化 ====================

/**
 * 序列化表单数据为对象
 * @param {HTMLFormElement|Element|string} form - 表单元素或选择器
 * @returns {Object}
 */
function serializeForm(form) {
    const formEl = typeof form === 'string' ? qs(form) : form;
    if (!formEl) return {};
    
    const formData = new FormData(formEl);
    const data = {};
    
    for (const [key, value] of formData) {
        if (data[key] !== undefined) {
            // 处理多值字段（如复选框）
            if (!Array.isArray(data[key])) {
                data[key] = [data[key]];
            }
            data[key].push(value);
        } else {
            data[key] = value;
        }
    }
    
    return data;
}

/**
 * 将对象填充到表单
 * @param {HTMLFormElement|Element|string} form - 表单元素或选择器
 * @param {Object} data - 数据对象
 */
function fillForm(form, data) {
    const formEl = typeof form === 'string' ? qs(form) : form;
    if (!formEl) return;
    
    Object.entries(data).forEach(([key, value]) => {
        const input = formEl.querySelector(`[name="${key}"]`);
        if (!input) return;
        
        const type = input.type;
        
        if (type === 'checkbox') {
            input.checked = Boolean(value);
        } else if (type === 'radio') {
            const radio = formEl.querySelector(`[name="${key}"][value="${value}"]`);
            if (radio) radio.checked = true;
        } else if (input.tagName === 'SELECT' && input.multiple && Array.isArray(value)) {
            Array.from(input.options).forEach(option => {
                option.selected = value.includes(option.value);
            });
        } else {
            input.value = value ?? '';
        }
    });
}

/**
 * 清空表单
 * @param {HTMLFormElement|Element|string} form - 表单元素或选择器
 */
function clearForm(form) {
    const formEl = typeof form === 'string' ? qs(form) : form;
    if (!formEl) return;
    
    formEl.reset();
}

/**
 * 验证表单
 * @param {HTMLFormElement|Element|string} form - 表单元素或选择器
 * @returns {boolean}
 */
function validateForm(form) {
    const formEl = typeof form === 'string' ? qs(form) : form;
    if (!formEl) return false;
    
    return formEl.checkValidity();
}

// ==================== 数据验证工具 ====================

/**
 * 验证器对象
 */
const Validator = {
    /**
     * 验证邮箱
     * @param {string} email - 邮箱地址
     * @returns {boolean}
     */
    isEmail(email) {
        const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return pattern.test(email);
    },
    
    /**
     * 验证手机号（中国大陆）
     * @param {string} phone - 手机号
     * @returns {boolean}
     */
    isPhone(phone) {
        const pattern = /^1[3-9]\d{9}$/;
        return pattern.test(phone);
    },
    
    /**
     * 验证URL
     * @param {string} url - URL地址
     * @returns {boolean}
     */
    isURL(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    },
    
    /**
     * 验证是否为数字
     * @param {*} value - 要验证的值
     * @returns {boolean}
     */
    isNumber(value) {
        return !isNaN(parseFloat(value)) && isFinite(value);
    },
    
    /**
     * 验证是否为整数
     * @param {*} value - 要验证的值
     * @returns {boolean}
     */
    isInteger(value) {
        return Number.isInteger(Number(value));
    },
    
    /**
     * 验证字符串长度
     * @param {string} str - 字符串
     * @param {number} min - 最小长度
     * @param {number} max - 最大长度
     * @returns {boolean}
     */
    isLength(str, min = 0, max = Infinity) {
        const len = String(str).length;
        return len >= min && len <= max;
    },
    
    /**
     * 验证是否为空
     * @param {*} value - 要验证的值
     * @returns {boolean}
     */
    isEmpty(value) {
        if (value === null || value === undefined) return true;
        if (typeof value === 'string') return value.trim() === '';
        if (Array.isArray(value)) return value.length === 0;
        if (typeof value === 'object') return Object.keys(value).length === 0;
        return false;
    },
    
    /**
     * 验证身份证号（中国大陆）
     * @param {string} idCard - 身份证号
     * @returns {boolean}
     */
    isIDCard(idCard) {
        const pattern = /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/;
        return pattern.test(idCard);
    },
    
    /**
     * 验证日期格式
     * @param {string} dateStr - 日期字符串
     * @param {string} format - 格式 ('YYYY-MM-DD', 'YYYY/MM/DD', 'DD-MM-YYYY')
     * @returns {boolean}
     */
    isDate(dateStr, format = 'YYYY-MM-DD') {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return false;
        
        // 简单格式验证
        const separators = format.replace(/YYYY|MM|DD/g, '').split('');
        const parts = dateStr.split(new RegExp(`[${separators.join('')}]+`));
        const formatParts = format.split(new RegExp(`[${separators.join('')}]+`));
        
        return parts.length === formatParts.length;
    },
    
    /**
     * 执行自定义验证规则
     * @param {*} value - 要验证的值
     * @param {Object} rules - 验证规则对象
     * @returns {Object} - { valid: boolean, errors: Array }
     */
    validate(value, rules) {
        const errors = [];
        
        if (rules.required && this.isEmpty(value)) {
            errors.push(rules.requiredMessage || '此字段为必填项');
        }
        
        if (!this.isEmpty(value)) {
            if (rules.minLength && !this.isLength(value, rules.minLength)) {
                errors.push(rules.minLengthMessage || `最小长度为${rules.minLength}`);
            }
            
            if (rules.maxLength && !this.isLength(value, 0, rules.maxLength)) {
                errors.push(rules.maxLengthMessage || `最大长度为${rules.maxLength}`);
            }
            
            if (rules.pattern && !rules.pattern.test(value)) {
                errors.push(rules.patternMessage || '格式不正确');
            }
            
            if (rules.custom && typeof rules.custom === 'function') {
                const result = rules.custom(value);
                if (result !== true) {
                    errors.push(result || '验证失败');
                }
            }
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }
};

// ==================== 导出 ====================

// 如果支持ES模块，则导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        qs, qsa, createElement, insertHTML,
        formatDate, getRelativeTime, parseDate,
        debounce, throttle,
        Storage, SessionStorage,
        URLParams,
        serializeForm, fillForm, clearForm, validateForm,
        Validator
    };
}
