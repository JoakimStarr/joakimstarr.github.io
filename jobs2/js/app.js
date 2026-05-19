/**
 * FinIntern Hub Web - 主应用逻辑 (精简版)
 */

const state = {
    currentPage: 'home',
    filters: { keyword: '', location: '', job_type: '', industry: '' },
    pagination: { page: 1, page_size: 20, total: 0 },
    crawlerStatus: null,
    crawlerHeadless: localStorage.getItem('crawlerHeadless') !== 'false' // 从localStorage读取，默认true
};

let crawlerPollingInterval = null;

document.addEventListener('DOMContentLoaded', () => {
    logger.info('Application starting', { version: '2.0.0' });
    initNavigation();
    initEventListeners();
    loadPage('home');
});

function initNavigation() {
    logger.info('Initializing navigation');
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            if (page) {
                logger.logUserAction('navigate', { from: state.currentPage, to: page });
                document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                loadPage(page);
            }
        });
    });
}

function initEventListeners() {
    logger.info('Initializing event listeners');
    const searchInput = document.getElementById('global-search');
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            state.filters.keyword = e.target.value.trim();
            logger.logUserAction('search', { keyword: state.filters.keyword });
            state.currentPage === 'jobs' ? loadJobsPage() : loadPage('jobs');
        }, 500);
    });
    
    document.getElementById('refresh-btn').addEventListener('click', () => {
        logger.logUserAction('refresh', { page: state.currentPage });
        loadPage(state.currentPage);
        showToast('页面已刷新', 'success');
    });
}

async function loadPage(page) {
    logger.info(`Loading page: ${page}`);
    const oldPage = state.currentPage;
    state.currentPage = page;
    logger.logStateChange('currentPage', oldPage, page);
    
    const content = document.getElementById('content');
    const titles = { home: '首页', jobs: '岗位列表', favorites: '我的收藏', crawler: '数据采集' };
    document.getElementById('page-title').textContent = titles[page] || '首页';
    
    content.innerHTML = '<div class="flex justify-center items-center h-64"><i class="fas fa-spinner fa-spin text-3xl text-blue-500"></i></div>';
    
    try {
        const startTime = Date.now();
        switch (page) {
            case 'home': await loadHomePage(); break;
            case 'jobs': await loadJobsPage(); break;
            case 'favorites': await loadFavoritesPage(); break;
            case 'crawler': await loadCrawlerPage(); break;
        }
        const duration = Date.now() - startTime;
        logger.info(`Page loaded: ${page}`, { duration });
    } catch (error) {
        logger.error(`Failed to load page: ${page}`, { error: error.message, stack: error.stack });
        content.innerHTML = `<div class="text-center text-red-500 py-8">加载失败: ${error.message}</div>`;
    }
}

async function loadHomePage() {
    logger.debug('Loading home page data');
    const [stats, recentJobs] = await Promise.all([API.getStatsOverview(), API.getJobs({ page_size: 5 })]);
    state.stats = stats;
    logger.info('Home page data loaded', { stats: stats.overview, jobsCount: recentJobs.items.length });
    
    document.getElementById('content').innerHTML = `
        <div class="fade-in space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-4 gap-6">
                ${renderStatCard('总岗位数', stats.overview.total_jobs, 'fa-briefcase', 'blue')}
                ${renderStatCard('收藏岗位', stats.overview.favorite_jobs, 'fa-star', 'yellow')}
                ${renderStatCard('今日新增', stats.overview.today_jobs, 'fa-plus', 'green')}
                ${renderStatCard('数据来源', stats.overview.sources_count, 'fa-database', 'purple')}
            </div>
            <div class="bg-white rounded-xl p-6 shadow-sm">
                <h3 class="text-lg font-bold mb-4">热门关键词</h3>
                <div class="flex flex-wrap gap-2">${stats.hot_keywords.map(kw => 
                    `<span class="px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-sm">${kw.keyword} (${kw.count})</span>`
                ).join('')}</div>
            </div>
            <div class="bg-white rounded-xl p-6 shadow-sm">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-lg font-bold">最新岗位</h3>
                    <button onclick="loadPage('jobs')" class="text-blue-600 hover:text-blue-700 text-sm">查看全部 <i class="fas fa-arrow-right ml-1"></i></button>
                </div>
                <div class="space-y-3">${recentJobs.items.map(renderJobCard).join('')}</div>
            </div>
        </div>`;
}

function renderStatCard(title, value, icon, color) {
    return `
        <div class="bg-white rounded-xl p-6 shadow-sm card-hover">
            <div class="flex items-center justify-between">
                <div>
                    <p class="text-gray-500 text-sm">${title}</p>
                    <p class="text-3xl font-bold text-gray-800">${value}</p>
                </div>
                <div class="w-12 h-12 bg-${color}-100 rounded-lg flex items-center justify-center">
                    <i class="fas ${icon} text-${color}-600 text-xl"></i>
                </div>
            </div>
        </div>`;
}

async function loadJobsPage() {
    logger.debug('Loading jobs page', { filters: state.filters, pagination: state.pagination });
    const [jobs, filters] = await Promise.all([
        API.getJobs({ ...state.pagination, ...state.filters }),
        API.getFilterOptions()
    ]);
    
    state.pagination.total = jobs.total;
    logger.info('Jobs loaded', { count: jobs.items.length, total: jobs.total });
    
    document.getElementById('content').innerHTML = `
        <div class="fade-in space-y-6">
            <div class="bg-white rounded-xl p-4 shadow-sm">
                <div class="flex flex-wrap gap-4">
                    ${renderSelect('filter-location', '所有地点', filters.locations, state.filters.location)}
                    ${renderSelect('filter-job-type', '所有类型', filters.job_types, state.filters.job_type)}
                    ${renderSelect('filter-industry', '所有行业', filters.industries, state.filters.industry)}
                    <button onclick="clearFilters()" class="text-gray-500 hover:text-gray-700"><i class="fas fa-times"></i> 清除</button>
                </div>
            </div>
            <div class="space-y-3">${jobs.items.length ? jobs.items.map(renderJobCard).join('') : '<div class="text-center text-gray-500 py-8">暂无数据</div>'}</div>
            ${renderPagination(jobs.page, jobs.pages, jobs.total)}
        </div>`;
}

function renderSelect(id, placeholder, options, value) {
    return `<select id="${id}" class="border rounded-lg px-3 py-2" onchange="updateFilter('${id.replace('filter-', '')}', this.value)">
        <option value="">${placeholder}</option>
        ${options.map(opt => `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>`).join('')}
    </select>`;
}

async function loadFavoritesPage() {
    logger.debug('Loading favorites page');
    const favorites = await API.getFavorites(state.pagination);
    logger.info('Favorites loaded', { count: favorites.items.length });
    document.getElementById('content').innerHTML = `
        <div class="fade-in space-y-6">
            <div class="space-y-3">${favorites.items.length ? favorites.items.map(renderJobCard).join('') : '<div class="text-center text-gray-500 py-8">暂无收藏</div>'}</div>
            ${renderPagination(favorites.page, favorites.pages, favorites.total)}
        </div>`;
}

async function loadCrawlerPage() {
    logger.debug('Loading crawler page');
    const [status, logs, sources] = await Promise.all([API.getCrawlerStatus(), API.getCrawlerLogs(10), API.getCrawlerSources()]);

    // 确保状态值有效
    const isRunning = status.is_running === true;
    const progress = status.progress || 0;
    const message = status.message || '';
    const currentSource = status.current_source || '';

    const oldStatus = state.crawlerStatus;
    state.crawlerStatus = { ...status, is_running: isRunning };

    if (oldStatus?.is_running !== isRunning) {
        logger.logStateChange('crawlerStatus', oldStatus?.status, status.status);
    }

    logger.debug('Crawler status rendered', { isRunning, progress, message });

    document.getElementById('content').innerHTML = `
        <div class="fade-in space-y-6">
            <div class="bg-white rounded-xl p-6 shadow-sm">
                <h3 class="text-lg font-bold mb-4">爬虫状态</h3>
                <div class="flex items-center gap-4 mb-4">
                    <div class="flex items-center gap-2">
                        <div class="w-3 h-3 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}"></div>
                        <span class="font-medium">${isRunning ? '运行中' : '已停止'}</span>
                    </div>
                    ${currentSource ? `<span class="text-gray-500">当前: ${currentSource}</span>` : ''}
                </div>
                ${isRunning ? `<div class="mb-4"><div class="flex justify-between text-sm mb-1"><span>进度</span><span>${Math.round(progress)}%</span></div><div class="w-full bg-gray-200 rounded-full h-2"><div class="bg-blue-600 h-2 rounded-full transition-all" style="width: ${progress}%"></div></div><p class="text-sm text-gray-500 mt-2">${message}</p></div>` : ''}

                <!-- 爬虫配置选项 -->
                <div class="mb-4 p-4 bg-gray-50 rounded-lg">
                    <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" id="headless-mode" ${state.crawlerHeadless ? 'checked' : ''} 
                            onchange="saveHeadlessMode(this.checked)"
                            class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500">
                        <span class="text-sm font-medium text-gray-700">无头模式（后台运行，不显示浏览器窗口）</span>
                    </label>
                    <p class="text-xs text-gray-500 mt-1 ml-6">取消勾选可打开Edge浏览器可视化爬取过程</p>
                </div>

                <div class="flex gap-3">
                    <button id="btn-start-crawler" onclick="startCrawler()" ${isRunning ? 'disabled' : ''} class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all">
                        <i class="fas fa-play mr-2"></i>启动
                    </button>
                    <button id="btn-stop-crawler" onclick="stopCrawler()" ${!isRunning ? 'disabled' : ''} class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all">
                        <i class="fas fa-stop mr-2"></i>停止
                    </button>
                </div>
            </div>
            <div class="bg-white rounded-xl p-6 shadow-sm">
                <h3 class="text-lg font-bold mb-4">最近日志</h3>
                <div class="space-y-2 max-h-64 overflow-y-auto">${logs.map(log => `
                    <div class="flex items-start gap-3 p-2 rounded ${log.level === 'ERROR' ? 'bg-red-50' : 'bg-gray-50'}">
                        <i class="fas ${log.level === 'ERROR' ? 'fa-exclamation-circle text-red-500' : 'fa-info-circle text-blue-500'} mt-1"></i>
                        <div class="flex-1"><p class="text-sm">${log.message}</p><p class="text-xs text-gray-500">${log.timestamp}</p></div>
                    </div>
                `).join('')}</div>
            </div>
        </div>`;
}

function renderJobCard(job) {
    return `
        <div class="bg-white rounded-xl p-5 shadow-sm card-hover cursor-pointer" onclick="showJobDetail(${job.id})">
            <div class="flex items-start justify-between">
                <div class="flex-1">
                    <div class="flex items-center gap-3 mb-2">
                        <h4 class="font-bold text-lg text-gray-800">${job.title}</h4>
                        ${job.is_favorite ? '<i class="fas fa-star text-yellow-400"></i>' : ''}
                    </div>
                    <div class="flex items-center gap-4 text-sm text-gray-600 mb-3">
                        <span><i class="fas fa-building mr-1"></i>${job.company}</span>
                        <span><i class="fas fa-map-marker-alt mr-1"></i>${job.location || '未知'}</span>
                        <span><i class="fas fa-yen-sign mr-1"></i>${job.salary || '面议'}</span>
                    </div>
                    <p class="text-gray-500 text-sm line-clamp-2">${job.description || '暂无描述'}</p>
                    <div class="flex items-center gap-2 mt-3">
                        <span class="px-2 py-1 bg-blue-50 text-blue-600 rounded text-xs">${job.source}</span>
                        ${job.job_type ? `<span class="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs">${job.job_type}</span>` : ''}
                    </div>
                </div>
                <button onclick="event.stopPropagation(); toggleFavorite(${job.id}, ${!job.is_favorite})" class="p-2 text-gray-400 hover:text-yellow-400 transition"><i class="fas fa-star ${job.is_favorite ? 'text-yellow-400' : ''}"></i></button>
            </div>
        </div>`;
}

function renderPagination(currentPage, totalPages, total) {
    if (totalPages <= 1) return '';
    let pages = [];
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) pages.push(i);
        else if (i === currentPage - 2 || i === currentPage + 2) pages.push('...');
    }
    return `
        <div class="flex items-center justify-between bg-white rounded-xl p-4 shadow-sm">
            <span class="text-sm text-gray-500">共 ${total} 条</span>
            <div class="flex items-center gap-2">
                <button onclick="changePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''} class="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"><i class="fas fa-chevron-left"></i></button>
                ${pages.map(p => p === '...' ? '<span>...</span>' : `<button onclick="changePage(${p})" class="px-3 py-1 rounded ${p === currentPage ? 'bg-blue-600 text-white' : 'border hover:bg-gray-50'}">${p}</button>`).join('')}
                <button onclick="changePage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''} class="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"><i class="fas fa-chevron-right"></i></button>
            </div>
        </div>`;
}

async function showJobDetail(jobId) {
    logger.logUserAction('viewJobDetail', { jobId });
    try {
        const job = await API.getJob(jobId);
        document.getElementById('job-modal-content').innerHTML = `
            <div class="space-y-4">
                <div class="flex items-start justify-between">
                    <div><h2 class="text-2xl font-bold text-gray-800">${job.title}</h2><p class="text-lg text-gray-600 mt-1">${job.company}</p></div>
                    <button onclick="toggleFavorite(${job.id}, ${!job.is_favorite})" class="p-2 text-2xl ${job.is_favorite ? 'text-yellow-400' : 'text-gray-300'} hover:text-yellow-400"><i class="fas fa-star"></i></button>
                </div>
                <div class="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg">
                    <div><i class="fas fa-map-marker-alt text-gray-400 mr-2"></i>${job.location || '未知'}</div>
                    <div><i class="fas fa-yen-sign text-gray-400 mr-2"></i>${job.salary || '面议'}</div>
                    <div><i class="fas fa-briefcase text-gray-400 mr-2"></i>${job.job_type || '未知'}</div>
                    <div><i class="fas fa-industry text-gray-400 mr-2"></i>${job.industry || '未知'}</div>
                </div>
                <div><h3 class="font-bold mb-2">岗位描述</h3><p class="text-gray-600 whitespace-pre-line">${job.description || '暂无描述'}</p></div>
                ${job.requirements ? `<div><h3 class="font-bold mb-2">任职要求</h3><p class="text-gray-600 whitespace-pre-line">${job.requirements}</p></div>` : ''}
                <div class="flex gap-3 pt-4">
                    ${job.apply_url ? `<a href="${job.apply_url}" target="_blank" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-center hover:bg-blue-700"><i class="fas fa-external-link-alt mr-2"></i>申请</a>` : ''}
                </div>
            </div>`;
        document.getElementById('job-modal').classList.remove('hidden');
    } catch (error) {
        logger.error('Failed to load job detail', { jobId, error: error.message });
        showToast('加载失败', 'error');
    }
}

async function toggleFavorite(jobId, isFavorite) {
    logger.logUserAction('toggleFavorite', { jobId, isFavorite });
    try {
        await API.toggleFavorite(jobId);
        showToast(isFavorite ? '已收藏' : '已取消收藏', 'success');
        loadPage(state.currentPage);
    } catch (error) {
        logger.error('Failed to toggle favorite', { jobId, error: error.message });
        showToast('操作失败', 'error');
    }
}

function updateFilter(key, value) {
    const oldValue = state.filters[key];
    state.filters[key] = value;
    state.pagination.page = 1;
    logger.logStateChange('filter', { [key]: oldValue }, { [key]: value });
    loadJobsPage();
}

function clearFilters() {
    logger.logUserAction('clearFilters');
    state.filters = { keyword: '', location: '', job_type: '', industry: '' };
    state.pagination.page = 1;
    document.getElementById('global-search').value = '';
    loadJobsPage();
}

function changePage(page) {
    logger.logUserAction('changePage', { page });
    state.pagination.page = page;
    state.currentPage === 'jobs' ? loadJobsPage() : loadFavoritesPage();
}

// 防止重复点击的锁
let crawlerActionLock = false;

// 保存无头模式设置
function saveHeadlessMode(checked) {
    state.crawlerHeadless = checked;
    localStorage.setItem('crawlerHeadless', checked);
    logger.info('Headless mode changed', { headless: checked });
}

// 更新爬虫按钮状态
function updateCrawlerButtons(isRunning) {
    const startBtn = document.getElementById('btn-start-crawler');
    const stopBtn = document.getElementById('btn-stop-crawler');

    if (startBtn) {
        startBtn.disabled = isRunning;
        logger.debug('Start button disabled:', isRunning);
    }
    if (stopBtn) {
        stopBtn.disabled = !isRunning;
        logger.debug('Stop button disabled:', !isRunning);
    }
}

async function startCrawler() {
    // 防止重复点击
    if (crawlerActionLock) {
        logger.warn('Start crawler clicked while locked, ignoring');
        return;
    }

    // 检查当前状态
    if (state.crawlerStatus?.is_running) {
        logger.warn('Start crawler clicked but already running');
        showToast('爬虫正在运行中', 'warning');
        return;
    }

    crawlerActionLock = true;
    logger.logUserAction('startCrawler');
    logger.info('Current crawler status before start', {
        isRunning: state.crawlerStatus?.is_running,
        status: state.crawlerStatus?.status
    });

    // 读取无头模式设置
    const headlessCheckbox = document.getElementById('headless-mode');
    const headless = headlessCheckbox ? headlessCheckbox.checked : true;
    logger.info('Crawler configuration', { headless });

    // 立即更新UI状态（只更新按钮，不刷新整个页面）
    updateCrawlerButtons(true);
    // 更新状态显示
    const statusIndicator = document.querySelector('.w-3.h-3.rounded-full');
    const statusText = statusIndicator?.nextElementSibling;
    if (statusIndicator) {
        statusIndicator.className = 'w-3 h-3 rounded-full bg-green-500 animate-pulse';
    }
    if (statusText) {
        statusText.textContent = '运行中';
    }

    try {
        logger.info('Sending start crawler request');
        const result = await API.startCrawler({ keyword: '实习', max_jobs: 50, headless });
        logger.info('Start crawler response received', { success: result.success, message: result.message });

        if (result.success) {
            showToast('爬虫已启动', 'success');
            // 然后轮询获取最新状态
            startCrawlerPolling();
        } else {
            logger.warn('Crawler start failed', { message: result.message });
            showToast(result.message || '启动失败', 'error');
            // 如果启动失败，重置状态
            state.crawlerStatus = { ...state.crawlerStatus, is_running: false, status: 'idle' };
            updateCrawlerButtons(false);
            loadCrawlerPage();
        }
    } catch (error) {
        logger.error('Failed to start crawler', { error: error.message, stack: error.stack });
        showToast('启动失败: ' + error.message, 'error');
        // 发生错误，重置状态
        state.crawlerStatus = { ...state.crawlerStatus, is_running: false, status: 'idle' };
        updateCrawlerButtons(false);
        loadCrawlerPage();
    } finally {
        // 延迟解锁，防止快速重复点击
        setTimeout(() => {
            crawlerActionLock = false;
            logger.debug('Crawler action lock released');
        }, 2000);
    }
}

async function updateCrawlerStatus() {
    logger.debug('Updating crawler status');
    try {
        const status = await API.getCrawlerStatus();
        const oldIsRunning = state.crawlerStatus?.is_running;
        const newIsRunning = status.is_running === true;
        
        logger.info('Crawler status received', { 
            status: status.status, 
            isRunning: newIsRunning,
            message: status.message,
            progress: status.progress,
            currentSource: status.current_source,
            elapsed: status.elapsed_seconds
        });
        
        // 如果状态发生变化，记录日志
        if (oldIsRunning !== newIsRunning) {
            logger.logStateChange('crawlerRunning', oldIsRunning, newIsRunning);
        }
        
        state.crawlerStatus = { ...status, is_running: newIsRunning };
        
        if (state.currentPage === 'crawler') {
            logger.debug('Refreshing crawler page with new status');
            loadCrawlerPage();
        }
    } catch (error) {
        logger.error('Failed to get crawler status', { error: error.message });
    }
}

function startCrawlerPolling() {
    logger.info('Starting crawler status polling');
    if (crawlerPollingInterval) clearInterval(crawlerPollingInterval);
    crawlerPollingInterval = setInterval(async () => {
        try {
            logger.debug('Polling crawler status');
            const status = await API.getCrawlerStatus();
            state.crawlerStatus = status;
            if (state.currentPage === 'crawler') loadCrawlerPage();
            if (status.status === 'completed' || status.status === 'error' || !status.is_running) {
                logger.info('Crawler finished, stopping polling', { status: status.status });
                clearInterval(crawlerPollingInterval);
                crawlerPollingInterval = null;
                if (status.status === 'completed') showToast('爬虫完成', 'success');
            }
        } catch (error) {
            logger.error('Polling failed', { error: error.message });
        }
    }, 2000);
}

async function stopCrawler() {
    // 防止重复点击
    if (crawlerActionLock) {
        logger.warn('Stop crawler clicked while locked, ignoring');
        return;
    }
    
    // 检查当前状态
    if (!state.crawlerStatus?.is_running) {
        logger.warn('Stop crawler clicked but not running');
        showToast('爬虫未在运行', 'warning');
        return;
    }
    
    crawlerActionLock = true;
    logger.logUserAction('stopCrawler');
    
    try {
        const result = await API.stopCrawler();
        logger.info('Stop crawler response', { result });
        if (result.success) {
            showToast('爬虫已停止', 'success');
            // 立即停止轮询
            if (crawlerPollingInterval) {
                clearInterval(crawlerPollingInterval);
                crawlerPollingInterval = null;
            }
            // 立即更新本地状态
            state.crawlerStatus = { ...state.crawlerStatus, is_running: false, status: 'idle' };
            loadCrawlerPage();
        } else {
            // 如果停止失败，刷新状态
            await updateCrawlerStatus();
        }
    } catch (error) {
        logger.error('Failed to stop crawler', { error: error.message });
        showToast('停止失败: ' + error.message, 'error');
    } finally {
        // 延迟解锁
        setTimeout(() => {
            crawlerActionLock = false;
            logger.debug('Crawler action lock released');
        }, 2000);
    }
}

function showToast(message, type = 'success') {
    logger.debug('Showing toast', { message, type });
    const toast = document.getElementById('toast');
    document.getElementById('toast-icon').className = type === 'success' ? 'fas fa-check-circle text-green-400' : 'fas fa-exclamation-circle text-red-400';
    document.getElementById('toast-message').textContent = message;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

/**
 * 显示数据更新提示框（带刷新按钮）
 */
function showDataUpdateNotification(newCount) {
    logger.info('Showing data update notification', { newCount });
    
    // 创建通知元素
    const notification = document.createElement('div');
    notification.id = 'data-update-notification';
    notification.className = 'fixed top-20 right-4 z-50 bg-white rounded-lg shadow-xl border-l-4 border-green-500 p-4 max-w-sm animate-slide-in';
    notification.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                <i class="fas fa-bell text-green-600"></i>
            </div>
            <div class="flex-1">
                <h4 class="font-semibold text-gray-800 mb-1">新数据已入库</h4>
                <p class="text-sm text-gray-600 mb-3">刚刚采集了 ${newCount} 条新职位数据，刷新页面即可查看。</p>
                <div class="flex gap-2">
                    <button onclick="refreshPage()" class="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition flex items-center gap-1">
                        <i class="fas fa-sync-alt"></i>
                        立即刷新
                    </button>
                    <button onclick="dismissNotification()" class="px-3 py-1.5 text-gray-500 text-sm hover:text-gray-700 transition">
                        稍后查看
                    </button>
                </div>
            </div>
            <button onclick="dismissNotification()" class="text-gray-400 hover:text-gray-600">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    
    // 添加动画样式
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slide-in {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-in {
            animation: slide-in 0.3s ease-out;
        }
    `;
    document.head.appendChild(style);
    
    // 添加到页面
    document.body.appendChild(notification);
    
    // 5秒后自动消失
    setTimeout(() => {
        dismissNotification();
    }, 5000);
}

/**
 * 关闭通知
 */
function dismissNotification() {
    const notification = document.getElementById('data-update-notification');
    if (notification) {
        notification.style.animation = 'slide-in 0.3s ease-out reverse';
        setTimeout(() => notification.remove(), 300);
    }
}

/**
 * 刷新页面
 */
function refreshPage() {
    logger.logUserAction('refreshPageFromNotification');
    window.location.reload();
}

document.getElementById('job-modal').addEventListener('click', (e) => {
    if (e.target.id === 'job-modal') e.target.classList.add('hidden');
});

// 添加全局错误处理
window.onerror = function(msg, url, line, col, error) {
    logger.error('Global error', { message: msg, url, line, col, error: error?.stack });
    return false;
};
