/**
 * FinIntern Hub - 实时通知组件
 * 支持SSE接收后端通知，显示Toast弹窗
 */

class NotificationManager {
    constructor() {
        this.eventSource = null;
        this.toastContainer = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000;
        
        this.init();
    }
    
    init() {
        // 创建Toast容器
        this.createToastContainer();
        
        // 监听爬虫启动事件
        document.addEventListener('crawler-started', () => {
            this.connect();
        });
        
        document.addEventListener('crawler-stopped', () => {
            this.disconnect();
        });
    }
    
    createToastContainer() {
        // 检查是否已存在
        if (document.getElementById('toast-container')) {
            this.toastContainer = document.getElementById('toast-container');
            return;
        }
        
        // 创建Toast容器
        this.toastContainer = document.createElement('div');
        this.toastContainer.id = 'toast-container';
        this.toastContainer.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 10px;
            max-width: 400px;
            pointer-events: none;
        `;
        document.body.appendChild(this.toastContainer);
    }
    
    connect() {
        if (this.eventSource) {
            console.log('SSE已连接');
            return;
        }
        
        try {
            const baseUrl = window.location.origin;
            this.eventSource = new EventSource(`${baseUrl}/api/crawler/stream`);
            
            this.eventSource.onopen = () => {
                console.log('SSE连接已建立');
                this.isConnected = true;
                this.reconnectAttempts = 0;
            };
            
            this.eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleEvent(data);
                } catch (e) {
                    console.error('解析SSE消息失败:', e);
                }
            };
            
            this.eventSource.onerror = (error) => {
                console.error('SSE连接错误:', error);
                this.isConnected = false;
                
                // 尝试重连
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    console.log(`SSE重连中... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                    setTimeout(() => this.connect(), this.reconnectDelay);
                } else {
                    console.log('SSE重连次数已达上限');
                    this.showToast('连接已断开，请刷新页面重试', 'error');
                }
            };
            
        } catch (error) {
            console.error('创建SSE连接失败:', error);
        }
    }
    
    disconnect() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
            this.isConnected = false;
            console.log('SSE连接已关闭');
        }
    }
    
    handleEvent(data) {
        const event = data.event;
        const payload = data.data;
        
        switch (event) {
            case 'data_saved':
                this.showDataSavedToast(payload);
                break;
            case 'status_update':
                this.handleStatusUpdate(payload);
                break;
            case 'completed':
                this.showCompletedToast(payload);
                this.disconnect();
                break;
            default:
                console.log('未知事件:', event, payload);
        }
    }
    
    showDataSavedToast(data) {
        const message = data.message || `已保存 ${data.total_saved} 条新数据`;
        this.showToast(message, 'success', {
            title: '数据更新',
            duration: 3000,
            actions: [
                {
                    text: '刷新页面',
                    onClick: () => window.location.reload()
                }
            ]
        });
    }
    
    handleStatusUpdate(data) {
        // 可以在这里更新UI状态，如果需要的话
        console.log('爬虫状态更新:', data.message);
    }
    
    showCompletedToast(data) {
        const status = data.status === 'completed' ? 'success' : 'error';
        const title = data.status === 'completed' ? '采集完成' : '采集失败';
        
        this.showToast(data.message, status, {
            title: title,
            duration: 5000,
            actions: [
                {
                    text: '查看数据',
                    onClick: () => {
                        if (window.loadPage) {
                            window.loadPage('jobs');
                        } else {
                            window.location.href = '/jobs.html';
                        }
                    }
                }
            ]
        });
    }
    
    showToast(message, type = 'info', options = {}) {
        const {
            title = '',
            duration = 3000,
            actions = []
        } = options;
        
        // 创建Toast元素
        const toast = document.createElement('div');
        toast.style.cssText = `
            background: white;
            border-radius: 8px;
            padding: 16px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            display: flex;
            flex-direction: column;
            gap: 8px;
            pointer-events: auto;
            animation: slideIn 0.3s ease;
            border-left: 4px solid ${this.getBorderColor(type)};
            min-width: 280px;
        `;
        
        // 添加动画样式
        if (!document.getElementById('toast-animations')) {
            const style = document.createElement('style');
            style.id = 'toast-animations';
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes slideOut {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
        
        // 图标
        const icon = this.getIcon(type);
        
        // 标题
        const titleHtml = title ? `<div style="font-weight: 600; color: #1f2937; display: flex; align-items: center; gap: 8px;">${icon} ${title}</div>` : '';
        
        // 消息
        const messageHtml = `<div style="color: #4b5563; font-size: 14px;">${message}</div>`;
        
        // 操作按钮
        let actionsHtml = '';
        if (actions.length > 0) {
            actionsHtml = `<div style="display: flex; gap: 8px; margin-top: 8px;">` +
                actions.map(action => `
                    <button style="
                        padding: 6px 12px;
                        border: 1px solid #e5e7eb;
                        border-radius: 4px;
                        background: white;
                        color: #374151;
                        font-size: 12px;
                        cursor: pointer;
                        transition: all 0.2s;
                    " onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background='white'">
                        ${action.text}
                    </button>
                `).join('') +
                `</div>`;
        }
        
        toast.innerHTML = titleHtml + messageHtml + actionsHtml;
        
        // 绑定操作按钮事件
        if (actions.length > 0) {
            const buttons = toast.querySelectorAll('button');
            buttons.forEach((btn, idx) => {
                btn.addEventListener('click', () => {
                    if (actions[idx].onClick) {
                        actions[idx].onClick();
                    }
                    this.removeToast(toast);
                });
            });
        }
        
        // 添加到容器
        this.toastContainer.appendChild(toast);
        
        // 自动移除
        if (duration > 0) {
            setTimeout(() => this.removeToast(toast), duration);
        }
        
        // 点击关闭
        toast.addEventListener('click', (e) => {
            if (e.target === toast) {
                this.removeToast(toast);
            }
        });
    }
    
    removeToast(toast) {
        toast.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }
    
    getBorderColor(type) {
        const colors = {
            success: '#10b981',
            error: '#ef4444',
            warning: '#f59e0b',
            info: '#3b82f6'
        };
        return colors[type] || colors.info;
    }
    
    getIcon(type) {
        const icons = {
            success: '<i class="fas fa-check-circle" style="color: #10b981;"></i>',
            error: '<i class="fas fa-times-circle" style="color: #ef4444;"></i>',
            warning: '<i class="fas fa-exclamation-triangle" style="color: #f59e0b;"></i>',
            info: '<i class="fas fa-info-circle" style="color: #3b82f6;"></i>'
        };
        return icons[type] || icons.info;
    }
}

// 创建全局实例
const notificationManager = new NotificationManager();

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NotificationManager, notificationManager };
}
