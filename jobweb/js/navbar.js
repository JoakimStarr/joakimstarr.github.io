/**
 * FinIntern Hub - 导航栏组件
 * 统一处理侧边栏、主题切换、展示模式切换与移动端菜单。
 */

const NAV_ITEMS = [
    { id: 'home', label: '首页', icon: 'fas fa-home', href: './index.html', description: '平台概览和统计数据' },
    { id: 'jobs', label: '岗位列表', icon: 'fas fa-list', href: './jobs.html', description: '浏览所有实习岗位' },
    { id: 'favorites', label: '我的收藏', icon: 'fas fa-star', href: './favorites.html', description: '查看收藏的岗位' },
    { id: 'crawler', label: '数据采集', icon: 'fas fa-spider', href: './crawler.html', description: '管理和执行爬虫任务' },
    { id: 'system', label: '系统状态', icon: 'fas fa-gauge-high', href: './system.html', description: '查看配置中心与系统状态' },
    { id: 'recommendations', label: '智能推荐', icon: 'fas fa-wand-magic-sparkles', href: './recommendations.html', description: '根据个人信息生成智能推荐' },
    { id: 'users', label: '用户管理', icon: 'fas fa-users-gear', href: './users.html', description: '管理用户账号与权限', permission: 'manage_users' },
];

const APP_THEME_KEY = 'finintern_theme';
const APP_VIEW_MODE_KEY = 'finintern_view_mode';
const THEME_PRESETS = [
    { id: 'aurora', label: '极光', icon: 'fa-sun' },
    { id: 'graphite', label: '石墨', icon: 'fa-moon' },
    { id: 'copper', label: '琥珀', icon: 'fa-gem' },
];
const VIEW_MODES = [
    { id: 'visual', label: '可视化', icon: 'fa-chart-pie' },
    { id: 'text', label: '文本', icon: 'fa-align-left' },
];

function getStoredTheme() {
    return localStorage.getItem(APP_THEME_KEY) || 'aurora';
}

function getDisplayMode() {
    return localStorage.getItem(APP_VIEW_MODE_KEY) || 'visual';
}

function getPreferenceMeta(type, value) {
    const list = type === 'theme' ? THEME_PRESETS : VIEW_MODES;
    return list.find(option => option.id === value) || list[0];
}

function renderPreferenceDropdown(options, activeId, type, label) {
    const active = getPreferenceMeta(type, activeId);
    return `
        <div class="app-topbar-pref-group app-topbar-dropdown" data-pref-dropdown="${type}">
            <span class="app-topbar-pref-label">${label}</span>
            <div class="app-topbar-dropdown-wrap">
                <button type="button" class="app-topbar-dropdown-trigger" data-pref-trigger="${type}" aria-haspopup="listbox" aria-expanded="false" title="${label}">
                    <span class="app-topbar-dropdown-value">
                        <i class="fas ${active.icon}"></i>
                        <span>${active.label}</span>
                    </span>
                    <i class="fas fa-chevron-down app-topbar-dropdown-icon"></i>
                </button>
                <div class="app-topbar-dropdown-menu" data-pref-menu="${type}" role="listbox" aria-label="${label}">
                    ${options.map(option => `
                        <button
                            type="button"
                            class="app-topbar-dropdown-option ${option.id === activeId ? 'active' : ''}"
                            data-pref-type="${type}"
                            data-pref-value="${option.id}"
                            role="option"
                            aria-selected="${option.id === activeId ? 'true' : 'false'}"
                        >
                            <span class="app-topbar-dropdown-option-meta">
                                <i class="fas ${option.icon}"></i>
                                <span>${option.label}</span>
                            </span>
                            ${option.id === activeId ? '<i class="fas fa-check"></i>' : ''}
                        </button>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderNavbar(currentPage = 'home', options = {}) {
    const {
        showVersion = true,
        version = 'v3.9.2',
        brandName = 'FinIntern',
        brandDescription = '金融实习招聘平台',
        brandIcon = 'fas fa-briefcase',
        currentUser = null,
    } = options;

    const navItemsHTML = NAV_ITEMS.filter(item => {
        if (!item.permission) return true;
        const permissions = currentUser?.permissions || [];
        return permissions.includes(item.permission);
    }).map(item => {
        const isActive = item.id === currentPage;
        const activeClass = isActive ? 'active bg-white/10' : '';
        return `
            <a href="${item.href}"
               data-page="${item.id}"
               class="sidebar-item flex items-center gap-3 px-4 py-3 rounded-lg ${activeClass}"
               title="${item.description}">
                <i class="${item.icon} w-5 text-center"></i>
                <span>${item.label}</span>
            </a>
        `;
    }).join('');

    const versionHTML = showVersion ? `
        <div class="p-4 border-t border-gray-800">
            <div class="rounded-2xl bg-white/5 border border-white/10 px-3 py-3 app-sidebar-meta">
                <div class="flex items-center justify-between gap-2 text-sm text-gray-200">
                    <div class="min-w-0">
                        <div class="font-semibold truncate">${currentUser?.display_name || currentUser?.username || '未登录'}</div>
                        <div class="text-[11px] text-gray-400 truncate">${currentUser?.role || 'guest'}</div>
                    </div>
                    ${currentUser ? '<button class="text-gray-400 hover:text-white transition" onclick="AppAuth.logout()" title="退出登录"><i class="fas fa-right-from-bracket"></i></button>' : ''}
                </div>
                <div class="flex items-center gap-2 text-sm text-gray-300">
                    <i class="fas fa-info-circle"></i>
                    <span>${version}</span>
                </div>
                <div class="mt-3 text-[11px] leading-5 text-gray-500">
                    <div>网站声明：仅为个人学习开发作用</div>
                    <div>灵感来源：我们伟大的宝宝</div>
                    <div>网站作者：JoakimStarr / 文人病</div>
                </div>
            </div>
        </div>
    ` : '';

    return `
        <aside id="sidebar" class="w-64 bg-slate-900 text-white flex flex-col fixed h-full z-50 transition-transform duration-300 -translate-x-full md:translate-x-0">
            <div class="p-6">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                        <i class="${brandIcon} text-white"></i>
                    </div>
                    <div>
                        <h1 class="font-bold text-lg">${brandName}</h1>
                        <p class="text-xs text-gray-400">${brandDescription}</p>
                    </div>
                </div>
            </div>

            <nav class="flex-1 px-4 space-y-1">
                ${navItemsHTML}
            </nav>

            ${versionHTML}
        </aside>

        <div id="sidebar-overlay" class="fixed inset-0 bg-black bg-opacity-50 z-40 hidden md:hidden" onclick="closeMobileMenu()"></div>

        <button id="mobile-menu-btn" class="fixed top-4 left-4 z-[60] md:hidden bg-slate-900 text-white p-3 rounded-lg shadow-lg" onclick="toggleMobileMenu()">
            <i class="fas fa-bars"></i>
        </button>
    `;
}

function renderHeader(title = '首页', options = {}) {
    const {
        showSearch = true,
        searchPlaceholder = '搜索岗位...',
        showRefresh = true,
    } = options;

    const searchHTML = showSearch ? `
        <div class="relative">
            <input type="text" id="global-search" placeholder="${searchPlaceholder}"
                class="pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-64">
            <i class="fas fa-search absolute left-3 top-3 text-gray-400"></i>
        </div>
    ` : '';

    const refreshHTML = showRefresh ? `
        <button id="refresh-btn" class="p-2 text-gray-600 hover:text-blue-600 transition" onclick="handleRefresh()">
            <i class="fas fa-sync-alt"></i>
        </button>
    ` : '';

    return `
        <header class="bg-white shadow-sm border-b px-8 py-4 sticky top-0 z-40">
            <div class="flex items-center justify-between">
                <h2 id="page-title" class="text-2xl font-bold text-gray-800">${title}</h2>
                <div class="flex items-center gap-4">
                    ${searchHTML}
                    ${refreshHTML}
                </div>
            </div>
        </header>
    `;
}

function renderTopbarPreferences() {
    return '';
}

async function initNavbar(containerSelector = '#navbar-container', currentPage = 'home', options = {}) {
    const container = document.querySelector(containerSelector);
    if (!container) {
        console.error(`Navbar container not found: ${containerSelector}`);
        return;
    }

    const currentUser = await window.AppAuth?.loadCurrentUser(false);
    if (currentPage !== 'login' && !currentUser) {
        window.AppAuth?.redirectToLogin();
        return;
    }
    container.innerHTML = renderNavbar(currentPage, {
        ...options.navbar,
        currentUser,
    });
    initMobileMenuEvents();

    const currentItem = NAV_ITEMS.find(item => item.id === currentPage);
    if (currentItem) {
        document.title = `${currentItem.label} - FinIntern Hub`;
    }
}

function initMobileMenuEvents() {
    window.addEventListener('resize', debounce(() => {
        if (window.innerWidth >= 768) {
            closeMobileMenu();
        }
    }, 100));

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeMobileMenu();
        }
    });
}

function toggleMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar && overlay) {
        const isOpen = !sidebar.classList.contains('-translate-x-full');
        if (isOpen) {
            closeMobileMenu();
        } else {
            sidebar.classList.remove('-translate-x-full');
            overlay.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
        }
    }
}

function closeMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar && overlay) {
        sidebar.classList.add('-translate-x-full');
        overlay.classList.add('hidden');
        document.body.style.overflow = '';
    }
}

function handleRefresh() {
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        const icon = refreshBtn.querySelector('i');
        if (icon) icon.classList.add('fa-spin');
    }

    window.dispatchEvent(new CustomEvent('app:refresh'));

    setTimeout(() => {
        if (refreshBtn) {
            const icon = refreshBtn.querySelector('i');
            if (icon) icon.classList.remove('fa-spin');
        }
    }, 1000);
}

function setActivePage(pageId) {
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.classList.remove('active', 'bg-white/10');
    });

    const activeItem = document.querySelector(`[data-page="${pageId}"]`);
    if (activeItem) {
        activeItem.classList.add('active', 'bg-white/10');
    }

    const currentItem = NAV_ITEMS.find(item => item.id === pageId);
    if (currentItem) {
        const pageTitle = document.getElementById('page-title');
        if (pageTitle) pageTitle.textContent = currentItem.label;
        document.title = `${currentItem.label} - FinIntern Hub`;
    }
}

function getNavItem(pageId) {
    return NAV_ITEMS.find(item => item.id === pageId) || null;
}

function getAllNavItems() {
    return [...NAV_ITEMS];
}

function addNavItem(item, index = -1) {
    if (index >= 0 && index < NAV_ITEMS.length) {
        NAV_ITEMS.splice(index, 0, item);
    } else {
        NAV_ITEMS.push(item);
    }
}

function debounce(fn, delay = 300) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

function applyTheme(themeId) {
    const resolved = THEME_PRESETS.some(item => item.id === themeId) ? themeId : 'aurora';
    document.documentElement.setAttribute('data-theme', resolved);
    document.body?.setAttribute('data-theme', resolved);
    updatePreferenceVisualState('theme', resolved);
}

function setTheme(themeId) {
    localStorage.setItem(APP_THEME_KEY, themeId);
    applyTheme(themeId);
    window.dispatchEvent(new CustomEvent('app:theme-change', { detail: { theme: themeId } }));
}

function applyViewMode(modeId) {
    const resolved = VIEW_MODES.some(item => item.id === modeId) ? modeId : 'visual';
    document.documentElement.setAttribute('data-view-mode', resolved);
    document.body?.setAttribute('data-view-mode', resolved);
    updatePreferenceVisualState('view', resolved);
}

function setDisplayMode(modeId) {
    localStorage.setItem(APP_VIEW_MODE_KEY, modeId);
    applyViewMode(modeId);
    window.dispatchEvent(new CustomEvent('app:view-mode-change', { detail: { mode: modeId } }));
}

function updatePreferenceVisualState(type, activeValue) {
    const activeMeta = getPreferenceMeta(type, activeValue);
    document.querySelectorAll(`[data-pref-trigger="${type}"]`).forEach(trigger => {
        const valueNode = trigger.querySelector('.app-topbar-dropdown-value');
        if (valueNode) {
            valueNode.innerHTML = `<i class="fas ${activeMeta.icon}"></i><span>${activeMeta.label}</span>`;
        }
    });
    document.querySelectorAll(`[data-pref-menu="${type}"] .app-topbar-dropdown-option`).forEach(option => {
        const isActive = option.dataset.prefValue === activeValue;
        option.classList.toggle('active', isActive);
        option.setAttribute('aria-selected', isActive ? 'true' : 'false');
        const check = option.querySelector('.fa-check');
        if (isActive && !check) {
            option.insertAdjacentHTML('beforeend', '<i class="fas fa-check"></i>');
        }
        if (!isActive && check) {
            check.remove();
        }
    });
}

function bindPreferenceControls(root = document) {
    root.querySelectorAll('[data-pref-trigger]').forEach(trigger => {
        if (trigger.dataset.bound === '1') return;
        trigger.dataset.bound = '1';
        trigger.addEventListener('click', (event) => {
            event.stopPropagation();
            const type = trigger.dataset.prefTrigger;
            const dropdown = trigger.closest('[data-pref-dropdown]');
            const isOpen = dropdown?.classList.contains('open');
            closePreferenceDropdowns();
            if (dropdown && !isOpen) {
                dropdown.classList.add('open');
                trigger.setAttribute('aria-expanded', 'true');
            }
        });
    });

    root.querySelectorAll('[data-pref-menu] .app-topbar-dropdown-option').forEach(option => {
        if (option.dataset.bound === '1') return;
        option.dataset.bound = '1';
        option.addEventListener('click', () => {
            const type = option.dataset.prefType;
            const value = option.dataset.prefValue;
            if (type === 'theme') {
                setTheme(value);
            } else if (type === 'view') {
                setDisplayMode(value);
            }
            closePreferenceDropdowns();
        });
    });
}

function closePreferenceDropdowns() {
    document.querySelectorAll('[data-pref-dropdown].open').forEach(dropdown => {
        dropdown.classList.remove('open');
        const trigger = dropdown.querySelector('[data-pref-trigger]');
        if (trigger) {
            trigger.setAttribute('aria-expanded', 'false');
        }
    });
}

function mountTopbarPreferences(root = document) {
    return root;
}

function bootstrapAppearancePreferences() {
    document.documentElement.removeAttribute('data-theme');
    document.body?.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-view-mode');
    document.body?.removeAttribute('data-view-mode');
}

document.addEventListener('DOMContentLoaded', bootstrapAppearancePreferences);

function renderPageLayout(currentPage, contentHTML, options = {}) {
    const currentItem = NAV_ITEMS.find(item => item.id === currentPage);
    const pageTitle = currentItem ? currentItem.label : '首页';

    return `
        <div id="app" class="min-h-screen flex">
            <div id="navbar-container">
                ${renderNavbar(currentPage, options.navbar)}
            </div>

            <main class="flex-1 ml-0 md:ml-64 pt-20 md:pt-0">
                ${renderHeader(pageTitle, options.header)}
                <div id="content" class="p-8">
                    ${contentHTML}
                </div>
            </main>
        </div>
    `;
}

function initPage(currentPage, contentRenderer, options = {}) {
    const app = document.getElementById('app');
    if (!app) {
        console.error('App container not found');
        return;
    }

    const contentHTML = typeof contentRenderer === 'function' ? contentRenderer() : (contentRenderer || '');
    app.innerHTML = `
        <div id="navbar-container">
            ${renderNavbar(currentPage, options.navbar)}
        </div>
        <main class="flex-1 ml-0 md:ml-64 pt-20 md:pt-0">
            ${renderHeader(getNavItem(currentPage)?.label || '首页', options.header)}
            <div id="content" class="p-8">
                ${contentHTML}
            </div>
        </main>
    `;

    initMobileMenuEvents();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        renderNavbar,
        renderHeader,
        initNavbar,
        initPage,
        renderPageLayout,
        toggleMobileMenu,
        closeMobileMenu,
        setActivePage,
        getNavItem,
        getAllNavItems,
        addNavItem,
        getStoredTheme,
        getDisplayMode,
        setTheme,
        setDisplayMode,
        applyTheme,
        applyViewMode,
        NAV_ITEMS,
    };
}
