/**
 * FinIntern Hub Web - 前端日志系统
 * 记录所有用户操作、API调用和系统事件
 */

class FrontendLogger {
    constructor() {
        this.logs = [];
        this.maxLogs = 1000;
        this.sessionId = this._generateSessionId();
        this.startTime = Date.now();
        this.logLevels = {
            DEBUG: 0,
            INFO: 1,
            WARN: 2,
            ERROR: 3
        };
        this.currentLogLevel = this.logLevels.DEBUG;
        this._init();
    }

    _generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    _init() {
        this.info('Logger initialized', { 
            sessionId: this.sessionId, 
            userAgent: navigator.userAgent,
            url: window.location.href,
            timestamp: new Date().toISOString()
        });
        
        // 记录页面加载性能
        window.addEventListener('load', () => {
            setTimeout(() => {
                const perfData = performance.getEntriesByType('navigation')[0];
                if (perfData) {
                    this.info('Page performance metrics', {
                        loadTime: Math.round(perfData.loadEventEnd - perfData.startTime),
                        domReady: Math.round(perfData.domContentLoadedEventEnd - perfData.startTime),
                        dnsLookup: Math.round(perfData.domainLookupEnd - perfData.domainLookupStart),
                        tcpConnect: Math.round(perfData.connectEnd - perfData.connectStart),
                        responseTime: Math.round(perfData.responseEnd - perfData.responseStart)
                    });
                }
            }, 0);
        });

        // 全局错误捕获 - window.onerror
        window.onerror = (msg, url, line, col, error) => {
            this.error('Global JavaScript error', {
                message: msg,
                url: url,
                line: line,
                column: col,
                stack: error?.stack,
                errorName: error?.name
            });
            return false;
        };

        // 记录未处理的Promise错误 - unhandledrejection
        window.addEventListener('unhandledrejection', (e) => {
            this.error('Unhandled promise rejection', {
                reason: e.reason?.message || e.reason,
                stack: e.reason?.stack,
                type: 'unhandledrejection'
            });
        });

        // 记录资源加载错误
        window.addEventListener('error', (e) => {
            if (e.target !== window) {
                this.error('Resource loading error', {
                    tagName: e.target.tagName,
                    src: e.target.src || e.target.href,
                    type: 'resource'
                });
            }
        }, true);

        // 记录页面可见性变化
        document.addEventListener('visibilitychange', () => {
            this.info('Page visibility changed', {
                hidden: document.hidden,
                visibilityState: document.visibilityState
            });
        });

        // 记录网络状态变化
        window.addEventListener('online', () => {
            this.info('Network status: online');
        });

        window.addEventListener('offline', () => {
            this.warn('Network status: offline');
        });
    }

    _shouldLog(level) {
        return this.logLevels[level.toUpperCase()] >= this.currentLogLevel;
    }

    _log(level, message, data = {}) {
        if (!this._shouldLog(level)) {
            return null;
        }

        const logEntry = {
            timestamp: new Date().toISOString(),
            level: level.toUpperCase(),
            message: message,
            data: data,
            sessionId: this.sessionId,
            page: window.location.pathname,
            url: window.location.href,
            elapsed: Date.now() - this.startTime
        };

        this.logs.push(logEntry);

        // 限制日志数量
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }

        // 输出到控制台
        const consoleMethod = level === 'error' ? console.error : 
                             level === 'warn' ? console.warn : 
                             level === 'debug' ? console.debug : console.log;
        
        const style = this._getConsoleStyle(level);
        consoleMethod(`%c[${level.toUpperCase()}] ${message}`, style, data);

        return logEntry;
    }

    _getConsoleStyle(level) {
        const styles = {
            debug: 'color: #6c757d;',
            info: 'color: #0d6efd;',
            warn: 'color: #ffc107; font-weight: bold;',
            error: 'color: #dc3545; font-weight: bold;'
        };
        return styles[level] || '';
    }

    // 日志级别方法
    debug(message, data) {
        return this._log('debug', message, data);
    }

    info(message, data) {
        return this._log('info', message, data);
    }

    warn(message, data) {
        return this._log('warn', message, data);
    }

    error(message, data) {
        return this._log('error', message, data);
    }

    // 设置日志级别
    setLogLevel(level) {
        if (this.logLevels[level.toUpperCase()] !== undefined) {
            this.currentLogLevel = this.logLevels[level.toUpperCase()];
            this.info('Log level changed', { level: level });
        }
    }

    // 记录API调用
    logApiCall(apiName, params, startTime) {
        return this.info(`API call: ${apiName}`, {
            type: 'api_call',
            api: apiName,
            params: this._sanitizeParams(params),
            startTime: startTime,
            timestamp: new Date().toISOString()
        });
    }

    // 记录API响应
    logApiResponse(apiName, response, duration, success = true) {
        const level = success ? 'info' : 'error';
        return this._log(level, `API response: ${apiName}`, {
            type: 'api_response',
            api: apiName,
            response: this._truncateResponse(response),
            duration: duration,
            success: success,
            timestamp: new Date().toISOString()
        });
    }

    // 记录API错误
    logApiError(apiName, error, duration) {
        return this.error(`API error: ${apiName}`, {
            type: 'api_error',
            api: apiName,
            error: error.message || error,
            stack: error.stack,
            duration: duration,
            timestamp: new Date().toISOString()
        });
    }

    // 记录用户操作
    logUserAction(action, details = {}) {
        return this.info(`User action: ${action}`, {
            type: 'user_action',
            action: action,
            details: details,
            currentPage: typeof state !== 'undefined' ? state.currentPage : null,
            timestamp: new Date().toISOString()
        });
    }

    // 记录点击事件
    logClick(element, details = {}) {
        return this.info('User click', {
            type: 'click',
            element: {
                tagName: element.tagName,
                id: element.id,
                className: element.className,
                text: element.textContent?.substring(0, 50)
            },
            details: details,
            timestamp: new Date().toISOString()
        });
    }

    // 记录表单提交
    logFormSubmit(formName, data = {}) {
        return this.info(`Form submitted: ${formName}`, {
            type: 'form_submit',
            formName: formName,
            data: this._sanitizeParams(data),
            timestamp: new Date().toISOString()
        });
    }

    // 记录状态变化
    logStateChange(component, oldState, newState) {
        return this.info(`State change: ${component}`, {
            type: 'state_change',
            component: component,
            oldState: oldState,
            newState: newState,
            timestamp: new Date().toISOString()
        });
    }

    // 记录性能指标
    logPerformance(metricName, value, details = {}) {
        return this.info(`Performance: ${metricName}`, {
            type: 'performance',
            metric: metricName,
            value: value,
            details: details,
            timestamp: new Date().toISOString()
        });
    }

    // 获取所有日志
    getLogs(filter = {}) {
        let filtered = [...this.logs];
        
        if (filter.level) {
            const levelValue = this.logLevels[filter.level.toUpperCase()];
            filtered = filtered.filter(log => this.logLevels[log.level] >= levelValue);
        }
        
        if (filter.type) {
            filtered = filtered.filter(log => log.data?.type === filter.type);
        }
        
        if (filter.search) {
            const search = filter.search.toLowerCase();
            filtered = filtered.filter(log => 
                log.message.toLowerCase().includes(search) ||
                JSON.stringify(log.data).toLowerCase().includes(search)
            );
        }

        if (filter.startTime) {
            filtered = filtered.filter(log => new Date(log.timestamp) >= new Date(filter.startTime));
        }

        if (filter.endTime) {
            filtered = filtered.filter(log => new Date(log.timestamp) <= new Date(filter.endTime));
        }

        return filtered;
    }

    // 获取日志统计
    getStats() {
        const stats = {
            total: this.logs.length,
            byLevel: {},
            byType: {},
            sessionDuration: Date.now() - this.startTime
        };

        this.logs.forEach(log => {
            // 按级别统计
            stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;
            
            // 按类型统计
            const type = log.data?.type || 'other';
            stats.byType[type] = (stats.byType[type] || 0) + 1;
        });

        return stats;
    }

    // 导出日志为JSON
    exportLogs(format = 'json', filter = {}) {
        const logs = this.getLogs(filter);
        
        switch (format.toLowerCase()) {
            case 'json':
                return JSON.stringify({
                    exportTime: new Date().toISOString(),
                    sessionId: this.sessionId,
                    stats: this.getStats(),
                    logs: logs
                }, null, 2);
            
            case 'csv':
                return this._exportToCSV(logs);
            
            case 'txt':
                return this._exportToText(logs);
            
            default:
                return JSON.stringify(logs, null, 2);
        }
    }

    // 导出为CSV格式
    _exportToCSV(logs) {
        const headers = ['Timestamp', 'Level', 'Message', 'Data', 'Page', 'Elapsed(ms)'];
        const rows = logs.map(log => [
            log.timestamp,
            log.level,
            `"${log.message.replace(/"/g, '""')}"`,
            `"${JSON.stringify(log.data).replace(/"/g, '""')}"`,
            log.page,
            log.elapsed
        ]);
        
        return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    }

    // 导出为文本格式
    _exportToText(logs) {
        return logs.map(log => 
            `[${log.timestamp}] [${log.level}] ${log.message} ${JSON.stringify(log.data)}`
        ).join('\n');
    }

    // 下载日志文件
    downloadLogs(format = 'json', filter = {}) {
        const content = this.exportLogs(format, filter);
        const blob = new Blob([content], { 
            type: format === 'json' ? 'application/json' : 'text/plain' 
        });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `logs_${this.sessionId}_${Date.now()}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.info('Logs downloaded', { format, count: this.getLogs(filter).length });
    }

    // 清空日志
    clear() {
        const count = this.logs.length;
        this.logs = [];
        this.info('Logs cleared', { previousCount: count });
    }

    // 辅助方法：清理敏感参数
    _sanitizeParams(params) {
        if (!params) return params;
        
        const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth', 'credential'];
        const sanitized = {};
        
        for (const [key, value] of Object.entries(params)) {
            if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
                sanitized[key] = '***';
            } else {
                sanitized[key] = value;
            }
        }
        
        return sanitized;
    }

    // 辅助方法：截断响应数据
    _truncateResponse(response, maxLength = 1000) {
        const str = JSON.stringify(response);
        if (str.length <= maxLength) return response;
        
        return {
            _truncated: true,
            _originalSize: str.length,
            preview: str.substring(0, maxLength) + '...'
        };
    }
}

// 创建全局日志实例
const logger = new FrontendLogger();

// 重写API调用以记录日志（在API对象存在时）
if (typeof API !== 'undefined' && API.request) {
    const originalRequest = API.request.bind(API);
    
    API.request = async function(url, options = {}) {
        const startTime = Date.now();
        const apiName = url.split('?')[0];
        
        logger.logApiCall(apiName, options.body || options.params, startTime);
        
        try {
            const result = await originalRequest(url, options);
            const duration = Date.now() - startTime;
            logger.logApiResponse(apiName, result, duration, true);
            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            logger.logApiError(apiName, error, duration);
            throw error;
        }
    };
}

// 导出供模块使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FrontendLogger, logger };
}
