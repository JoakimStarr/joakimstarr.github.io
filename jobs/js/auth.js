const AUTH_TOKEN_KEY = 'finintern_auth_token';
const AUTH_USER_KEY = 'finintern_auth_user';

const AppAuth = {
    getToken() {
        return localStorage.getItem(AUTH_TOKEN_KEY) || '';
    },

    setSession(token, user) {
        localStorage.setItem(AUTH_TOKEN_KEY, token);
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user || {}));
    },

    clearSession() {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
    },

    getCachedUser() {
        try {
            return JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null');
        } catch (error) {
            return null;
        }
    },

    hasPermission(permission) {
        const user = this.getCachedUser();
        return !!(user && Array.isArray(user.permissions) && user.permissions.includes(permission));
    },

    async loadCurrentUser(force = false) {
        if (!force) {
            const cached = this.getCachedUser();
            if (cached && cached.id && this.getToken()) {
                return cached;
            }
        }
        if (!this.getToken()) return null;
        try {
            const user = await API.getCurrentUser();
            localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
            return user;
        } catch (error) {
            this.clearSession();
            return null;
        }
    },

    async requireAuth(permission = '') {
        const user = await this.loadCurrentUser(true);
        if (!user) {
            this.redirectToLogin();
            return null;
        }
        if (permission && !(user.permissions || []).includes(permission)) {
            document.body.innerHTML = `
                <div class="min-h-screen flex items-center justify-center bg-slate-50 px-6">
                    <div class="max-w-lg w-full bg-white border border-slate-200 rounded-3xl shadow-sm p-10 text-center">
                        <div class="w-16 h-16 mx-auto rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center mb-5">
                            <i class="fas fa-shield-halved text-2xl"></i>
                        </div>
                        <h1 class="text-2xl font-bold text-slate-900 mb-3">当前账号没有访问权限</h1>
                        <p class="text-slate-600 leading-7">你已经登录，但当前账号没有访问这个页面所需的权限。请联系管理员，或切换其他账号后重试。</p>
                        <div class="mt-8 flex justify-center gap-3">
                            <a class="btn btn-outline" href="./index.html">返回首页</a>
                            <button class="btn btn-primary" onclick="AppAuth.logout()">退出登录</button>
                        </div>
                    </div>
                </div>
            `;
            return null;
        }
        return user;
    },

    redirectToLogin() {
        const target = `${window.location.pathname}${window.location.search || ''}`;
        if (!window.location.pathname.endsWith('/login.html') && !window.location.pathname.endsWith('login.html')) {
            window.location.href = `./login.html?redirect=${encodeURIComponent(target)}`;
        }
    },

    async logout() {
        try {
            if (this.getToken()) {
                await API.logout();
            }
        } catch (error) {
            console.warn('退出登录请求失败，已执行本地清理', error);
        } finally {
            this.clearSession();
            window.location.href = './login.html';
        }
    }
};

window.AppAuth = AppAuth;
