(function () {
  const FAVORITES_KEY = 'jobweb-favorites';
  const HISTORY_KEY = 'jobweb-recent-recommendations';
  const AUTH_USER_KEY = 'jobweb-auth-user';
  const AUTH_USERS_KEY = 'jobweb-auth-users';
  const CRAWLER_LOGS_KEY = 'jobweb-crawler-logs';
  const AI_CONFIG_KEY = 'jobweb-ai-config';
  const AI_CHAT_KEY = 'jobweb-ai-chat-history';
  const APPLICATIONS_KEY = 'jobweb-applications';
  const SUBSCRIPTIONS_KEY = 'jobweb-subscriptions';

  const DEFAULT_USERS = [
    { id: 1, username: 'admin', password: 'Admin@123456', display_name: '系统管理员', role: 'admin', is_active: true, last_login_at: '' },
    { id: 2, username: 'operator', password: 'Operator@123', display_name: '采集运营', role: 'operator', is_active: true, last_login_at: '' },
    { id: 3, username: 'viewer', password: 'Viewer@123', display_name: '普通访客', role: 'viewer', is_active: true, last_login_at: '' },
  ];

  const ROLE_PERMISSIONS = {
    admin: ['view_jobs', 'view_stats', 'use_recommendations', 'manage_crawler', 'view_system', 'manage_users'],
    operator: ['view_jobs', 'view_stats', 'use_recommendations', 'manage_crawler', 'view_system'],
    viewer: ['view_jobs', 'view_stats', 'use_recommendations'],
  };

  function getSnapshot() {
    return window.JOBWEB_SNAPSHOT || { meta: {}, stats: {}, jobs: [] };
  }

  function getSnapshotAiDefaults() {
    const snapshot = getSnapshot();
    const ai = snapshot && snapshot.meta ? snapshot.meta.ai : null;
    return ai && typeof ai === 'object' ? ai : {};
  }

  const DEFAULT_AI_CONFIG = Object.assign({
    apiKey: '',
    model: 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B',
    fallbackModels: ['deepseek-ai/DeepSeek-R1-Distill-Qwen-7B', 'Qwen/Qwen3-8B', 'Qwen/Qwen3.5-4B'],
    baseUrl: 'https://api.siliconflow.cn/v1',
    useStream: true,
    timeout: 60,
    maxOutputTokens: 700,
  }, getSnapshotAiDefaults());

  function normalizeAiBaseUrl(baseUrl) {
    const raw = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!raw) return 'https://api.siliconflow.cn/v1/chat/completions';
    return raw.endsWith('/chat/completions') ? raw : `${raw}/chat/completions`;
  }

  function getPermissions(role) {
    return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.viewer;
  }

  function readAiConfig() {
    try {
      const parsed = JSON.parse(localStorage.getItem(AI_CONFIG_KEY) || 'null');
      if (parsed && typeof parsed === 'object') {
        const merged = Object.assign({}, DEFAULT_AI_CONFIG, parsed);
        merged.baseUrl = normalizeAiBaseUrl(merged.baseUrl);
        merged.fallbackModels = Array.isArray(merged.fallbackModels)
          ? merged.fallbackModels.filter(Boolean)
          : String(merged.fallbackModels || '').split(',').map(item => item.trim()).filter(Boolean);
        return merged;
      }
    } catch (_) {}
    return Object.assign({}, DEFAULT_AI_CONFIG, {
      baseUrl: normalizeAiBaseUrl(DEFAULT_AI_CONFIG.baseUrl),
      fallbackModels: Array.isArray(DEFAULT_AI_CONFIG.fallbackModels) ? DEFAULT_AI_CONFIG.fallbackModels.slice() : [],
    });
  }

  function writeAiConfig(config) {
    const next = Object.assign({}, DEFAULT_AI_CONFIG, config || {});
    next.baseUrl = normalizeAiBaseUrl(next.baseUrl);
    next.fallbackModels = Array.isArray(next.fallbackModels)
      ? next.fallbackModels.filter(Boolean)
      : String(next.fallbackModels || '').split(',').map(item => item.trim()).filter(Boolean);
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(next));
  }

  function readAiChatHistory(scope) {
    try {
      const all = JSON.parse(localStorage.getItem(AI_CHAT_KEY) || '{}');
      return Array.isArray(all[scope]) ? all[scope] : [];
    } catch (_) {
      return [];
    }
  }

  function writeAiChatHistory(scope, messages) {
    let all = {};
    try {
      all = JSON.parse(localStorage.getItem(AI_CHAT_KEY) || '{}') || {};
    } catch (_) {
      all = {};
    }
    all[scope] = (messages || []).slice(-12);
    localStorage.setItem(AI_CHAT_KEY, JSON.stringify(all));
  }

  async function callAi(messages, options) {
    const config = readAiConfig();
    if (!config.apiKey) {
      throw new Error('请先在系统概览页配置 SiliconFlow API Key');
    }
    const models = [];
    const primaryModel = (options && options.model) || config.model;
    if (primaryModel) models.push(primaryModel);
    (config.fallbackModels || []).forEach(model => {
      if (model && !models.includes(model)) {
        models.push(model);
      }
    });

    let lastError = null;
    for (const model of models) {
      const payload = {
        model,
        messages,
        stream: !!config.useStream,
        max_tokens: Number(config.maxOutputTokens) || 700,
      };

      try {
        const response = await fetch(config.baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`模型 ${model} 请求失败：${response.status} ${text.slice(0, 160)}`);
        }

        if (!config.useStream) {
          const data = await response.json();
          return data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content || '' : '';
        }

        const reader = response.body && response.body.getReader ? response.body.getReader() : null;
        if (!reader) {
          const text = await response.text();
          return text;
        }

        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let content = '';
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          buffer += decoder.decode(result.value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const dataChunk = trimmed.replace(/^data:\s*/, '');
            if (dataChunk === '[DONE]') continue;
            try {
              const json = JSON.parse(dataChunk);
              const delta = json.choices && json.choices[0] ? json.choices[0].delta || {} : {};
              if (delta.content) {
                content += delta.content;
                if (options && typeof options.onToken === 'function') options.onToken(content);
              }
            } catch (_) {}
          }
        }
        return content;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('AI 请求失败');
  }

  function readUsers() {
    try {
      const parsed = JSON.parse(localStorage.getItem(AUTH_USERS_KEY) || 'null');
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch (_) {}
    localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(DEFAULT_USERS));
    return DEFAULT_USERS.slice();
  }

  function writeUsers(users) {
    localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
  }

  function getCurrentUser() {
    try {
      return JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null');
    } catch (_) {
      return null;
    }
  }

  function setCurrentUser(user) {
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  }

  function clearCurrentUser() {
    localStorage.removeItem(AUTH_USER_KEY);
  }

  function logout() {
    clearCurrentUser();
    if (!String(window.location.pathname).endsWith('/login.html')) {
      window.location.href = './login.html';
    }
  }

  function readCrawlerLogs() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CRAWLER_LOGS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function readApplications() {
    try {
      const parsed = JSON.parse(localStorage.getItem(APPLICATIONS_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeApplications(payload) {
    localStorage.setItem(APPLICATIONS_KEY, JSON.stringify(payload || {}));
  }

  function readSubscriptions() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SUBSCRIPTIONS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeSubscriptions(items) {
    localStorage.setItem(SUBSCRIPTIONS_KEY, JSON.stringify((items || []).slice(0, 30)));
  }

  function writeCrawlerLogs(logs) {
    localStorage.setItem(CRAWLER_LOGS_KEY, JSON.stringify(logs.slice(0, 120)));
  }

  function appendCrawlerLog(entry) {
    const next = [entry].concat(readCrawlerLogs()).slice(0, 120);
    writeCrawlerLogs(next);
  }

  function requirePermission(permission) {
    const user = getCurrentUser();
    if (!user) {
      window.location.href = './login.html';
      return null;
    }
    if (permission && !getPermissions(user.role).includes(permission)) {
      document.body.innerHTML = `
        <div class="content" style="max-width:760px; margin:40px auto;">
          <section class="card">
            <div class="card-body empty">
              <h2 class="section-title">当前账号没有权限访问这个页面</h2>
              <p class="text-muted">请切换账号，或者进入用户管理页调整角色权限。</p>
              <div class="toolbar" style="justify-content:center; margin-top:18px;">
                <a class="btn btn-secondary" href="./index.html">返回首页</a>
                <button class="btn btn-primary" onclick="window.JobwebApp.logout()">退出登录</button>
              </div>
            </div>
          </section>
        </div>
      `;
      return null;
    }
    return user;
  }

  function readFavorites() {
    try {
      return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'));
    } catch (_) {
      return new Set();
    }
  }

  function writeFavorites(set) {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(set)));
  }

  function toggleFavorite(id) {
    const current = readFavorites();
    if (current.has(id)) current.delete(id);
    else current.add(id);
    writeFavorites(current);
  }

  function readHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch (_) {
      return [];
    }
  }

  function pushHistory(entry) {
    const current = readHistory();
    const next = [entry].concat(current.filter(item => item.id !== entry.id)).slice(0, 12);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  }

  function escapeHtml(text) {
    return String(text || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function formatDate(value) {
    if (!value) return '未知时间';
    return String(value).slice(0, 10);
  }

  function createLayout(pageId, title, subtitle) {
    const currentUser = getCurrentUser();
    const links = [
      ['index.html', '首页', 'fas fa-home', 'view_jobs'],
      ['jobs.html', '岗位列表', 'fas fa-list', 'view_jobs'],
      ['favorites.html', '我的收藏', 'fas fa-star', 'view_jobs'],
      ['recommendations.html', '智能推荐', 'fas fa-wand-magic-sparkles', 'use_recommendations'],
      ['crawler.html', '数据采集', 'fas fa-spider', 'manage_crawler'],
      ['system.html', '系统概览', 'fas fa-gauge-high', 'view_system'],
      ['users.html', '用户管理', 'fas fa-users-gear', 'manage_users'],
    ];
    return `
      <div id="app" class="min-h-screen flex">
        <aside id="sidebar" class="w-64 bg-slate-900 text-white flex flex-col fixed h-full z-50 transition-transform duration-300 -translate-x-full md:translate-x-0 jobweb-sidebar">
          <div class="p-6">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                <i class="fas fa-briefcase text-white"></i>
              </div>
              <div>
                <h1 class="font-bold text-lg">FinIntern</h1>
                <p class="text-xs text-gray-400">jobweb 网页版</p>
              </div>
            </div>
          </div>
          <nav class="flex-1 px-4 space-y-1">
            ${links.filter(([, , , permission]) => !permission || (currentUser && getPermissions(currentUser.role).includes(permission))).map(([href, label, icon]) => `
              <a href="./${href}" class="sidebar-item flex items-center gap-3 px-4 py-3 rounded-lg ${pageId === href ? 'active bg-white/10' : ''}">
                <i class="${icon} w-5 text-center"></i>
                <span>${label}</span>
              </a>
            `).join('')}
          </nav>
          <div class="p-4 border-t border-gray-800">
            <div class="rounded-2xl bg-white/5 border border-white/10 px-3 py-3 app-sidebar-meta">
              <div class="flex items-center justify-between gap-2 text-sm text-gray-200">
                <div class="min-w-0">
                  <div class="font-semibold truncate">${escapeHtml(currentUser ? currentUser.display_name : '未登录')}</div>
                  <div class="text-[11px] text-gray-400 truncate">${escapeHtml(currentUser ? currentUser.role : 'guest')}</div>
                </div>
                ${currentUser ? '<button class="text-gray-400 hover:text-white transition" id="sidebar-logout-btn" title="退出登录"><i class="fas fa-right-from-bracket"></i></button>' : ''}
              </div>
              <div class="flex items-center gap-2 text-sm text-gray-300 mt-2">
                <i class="fas fa-info-circle"></i>
                <span>v3.9.2</span>
              </div>
              <div class="mt-3 text-[11px] leading-5 text-gray-500">
                <div>网站声明：仅为个人学习开发作用</div>
                <div>灵感来源：我们伟大的宝宝</div>
                <div>网站作者：JoakimStarr / 文人病</div>
              </div>
            </div>
          </div>
        </aside>
        <div id="sidebar-overlay" class="fixed inset-0 bg-black bg-opacity-50 z-40 hidden md:hidden"></div>
        <button id="mobile-menu-btn" class="fixed top-4 left-4 z-[60] md:hidden bg-slate-900 text-white p-3 rounded-lg shadow-lg">
          <i class="fas fa-bars"></i>
        </button>
        <main class="flex-1 ml-0 md:ml-64 pt-20 md:pt-0 jobweb-main">
          <header class="bg-white shadow-sm border-b px-8 py-4 sticky top-0 z-40">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h2 id="page-title" class="text-2xl font-bold text-gray-800">${title}</h2>
                <p class="text-sm text-gray-500 mt-1">${subtitle}</p>
              </div>
              <div class="flex items-center gap-3">
                <span class="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-3 py-2 text-sm font-medium" id="snapshot-meta">正在读取数据…</span>
                <button class="btn btn-outline" id="refresh-btn" type="button">
                  <i class="fas fa-sync-alt"></i> 刷新
                </button>
                ${currentUser ? `<button class="btn btn-primary" id="logout-btn" type="button">退出登录</button>` : `<a class="btn btn-primary" href="./login.html">登录</a>`}
              </div>
            </div>
          </header>
          <div id="content" class="p-8">
            <div id="page-root"></div>
          </div>
        </main>
      </div>
      <div id="job-modal" class="fixed inset-0 bg-black bg-opacity-50 z-50 hidden flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden shadow-2xl">
          <div class="sticky top-0 bg-white/95 backdrop-blur border-b px-6 py-4 flex items-center justify-between">
            <div>
              <h3 class="text-lg font-semibold text-gray-900" id="detail-title">岗位详情</h3>
              <p class="text-sm text-gray-500" id="detail-subtitle"></p>
            </div>
            <button class="text-gray-400 hover:text-gray-700 transition" id="detail-close" type="button">
              <i class="fas fa-times text-xl"></i>
            </button>
          </div>
          <div id="detail-content" class="p-6 overflow-y-auto max-h-[calc(90vh-140px)]"></div>
          <div class="bg-white border-t px-6 py-4 flex items-center justify-end gap-3">
            <a class="btn btn-outline" id="detail-source" href="#" target="_blank" rel="noreferrer noopener">查看原网页</a>
            <a class="btn btn-primary" id="detail-apply" href="#" target="_blank" rel="noreferrer noopener">申请岗位</a>
          </div>
        </div>
      </div>
    `;
  }

  function bindSnapshotMeta(snapshot) {
    const meta = document.getElementById('snapshot-meta');
    if (meta) meta.textContent = `快照时间 ${formatDate(snapshot.meta.generated_at)} · ${snapshot.meta.total_jobs || 0} 个岗位`;
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    const sidebarLogoutBtn = document.getElementById('sidebar-logout-btn');
    if (sidebarLogoutBtn) sidebarLogoutBtn.addEventListener('click', logout);
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => window.location.reload());
    }
    const overlay = document.getElementById('sidebar-overlay');
    const sidebar = document.getElementById('sidebar');
    const mobileBtn = document.getElementById('mobile-menu-btn');
    if (overlay && sidebar && mobileBtn) {
      overlay.addEventListener('click', () => {
        sidebar.classList.add('-translate-x-full');
        overlay.classList.add('hidden');
      });
      mobileBtn.addEventListener('click', () => {
        const isHidden = sidebar.classList.contains('-translate-x-full');
        sidebar.classList.toggle('-translate-x-full', !isHidden);
        overlay.classList.toggle('hidden', !isHidden);
      });
    }
  }

  function animateCount(element, targetValue) {
    if (!element) return;
    const end = Number(targetValue) || 0;
    const start = 0;
    const duration = 850;
    const startedAt = performance.now();
    element.classList.add('count-animate');

    function frame(now) {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (end - start) * eased);
      element.textContent = String(current);
      if (progress < 1) requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  function animateMetricNumbers() {
    document.querySelectorAll('.metric-value[data-count]').forEach(node => {
      animateCount(node, node.getAttribute('data-count'));
    });
  }

  function bindDetailModal() {
    const modal = document.getElementById('job-modal');
    if (!modal) return;
    modal.addEventListener('click', (event) => {
      if (event.target === modal) modal.classList.add('hidden');
    });
    const close = document.getElementById('detail-close');
    if (close) close.addEventListener('click', () => modal.classList.add('hidden'));
  }

  function openJobDetail(job) {
    document.getElementById('detail-title').textContent = job.title || '岗位详情';
    document.getElementById('detail-subtitle').textContent = `${job.company || '未知公司'} · ${job.location || '地点待定'} · ${job.source || '未知来源'}`;
    const chatScope = `job-${job.id}`;
    const history = readAiChatHistory(chatScope);
    const applications = readApplications();
    const currentProgress = applications[job.id] || { status: '未投递', notes: '', timeline: [] };
    document.getElementById('detail-content').innerHTML = `
      <div class="space-y-5 job-detail-shell">
      <div class="flex flex-wrap gap-3" style="margin-bottom:20px;">
        <div class="pill">发布时间：${formatDate(job.publish_date || job.created_at)}</div>
        <div class="pill">岗位类型：${escapeHtml(job.job_type || '未知')}</div>
        <div class="pill">学历要求：${escapeHtml(job.education || '未说明')}</div>
        <div class="pill">薪资：${escapeHtml(job.salary || '面议')}</div>
      </div>
      <div class="border rounded-lg bg-gray-50 p-4 job-detail-section reveal-up motion-card">
        <div class="card-header">
          <div>
            <h4 class="section-title">求职进度与时间线</h4>
            <p class="text-muted">进度和记录会保存在当前浏览器本地。</p>
          </div>
        </div>
        <div class="card-body">
          <div class="toolbar" style="align-items:stretch;">
            <select class="select" id="job-progress-status" style="max-width:180px;">
              ${['未投递','已投递','笔试中','面试中','已Offer','已结束'].map(item => `<option value="${item}" ${currentProgress.status === item ? 'selected' : ''}>${item}</option>`).join('')}
            </select>
            <input class="input" id="job-progress-title" placeholder="新增一条时间线标题，例如 已完成一面">
            <button class="btn btn-secondary" id="job-progress-add">添加记录</button>
          </div>
          <textarea class="textarea" id="job-progress-notes" placeholder="记录投递备注、联系人、截止日期等信息" style="margin-top:12px;">${escapeHtml(currentProgress.notes || '')}</textarea>
          <div class="toolbar" style="margin-top:12px;">
            <button class="btn btn-primary" id="job-progress-save">保存进度</button>
          </div>
          <div id="job-progress-timeline" class="history-list" style="margin-top:16px;">${(currentProgress.timeline || []).length ? currentProgress.timeline.map(item => `
            <article class="card" style="box-shadow:none;"><div class="card-body" style="padding:14px 16px;"><strong>${escapeHtml(item.title)}</strong><div class="text-muted" style="margin-top:8px;">${escapeHtml(item.time)}</div></div></article>
          `).join('') : '<div class="empty">还没有时间线记录</div>'}</div>
        </div>
      </div>
      <div class="job-detail-section reveal-up motion-card">
      <div class="border rounded-lg bg-white p-4">
        <div class="card-body">
          <h4 class="section-title">岗位描述</h4>
          <div class="text-muted" style="white-space:pre-wrap; line-height:1.9;">${escapeHtml(job.description || '暂无描述')}</div>
          <h4 class="section-title" style="margin-top:20px;">任职要求</h4>
          <div class="text-muted" style="white-space:pre-wrap; line-height:1.9;">${escapeHtml(job.requirements || '暂无要求')}</div>
        </div>
      </div>
      </div>
      <div class="border rounded-lg bg-gray-50 p-4 job-detail-section reveal-up motion-card">
        <div class="card-header">
          <div>
            <h4 class="section-title">AI 推荐分析</h4>
            <p class="text-muted">页面会直接从浏览器调用 SiliconFlow 接口，分析当前岗位。</p>
          </div>
        </div>
        <div class="card-body">
          <div class="toolbar" style="margin-bottom:14px;">
            <button class="btn btn-primary" id="job-ai-run">生成 AI 分析</button>
          </div>
          <div id="job-ai-analysis" class="text-muted" style="white-space:pre-wrap; line-height:1.9; min-height:84px;">点击上方按钮后，AI 分析会显示在这里。</div>
          <div style="margin-top:18px;">
            <div class="section-title" style="font-size:16px;">岗位追问</div>
            <div id="job-ai-history" class="history-list" style="margin-top:10px;">${history.length ? history.map(item => `
              <article class="card" style="box-shadow:none;"><div class="card-body" style="padding:14px 16px;"><strong>${escapeHtml(item.role === 'user' ? '你' : 'AI')}</strong><div class="text-muted" style="margin-top:8px; white-space:pre-wrap;">${escapeHtml(item.content)}</div></div></article>
            `).join('') : '<div class="empty">还没有追问记录</div>'}</div>
            <div class="toolbar" style="margin-top:12px; flex-direction:column; align-items:stretch;">
              <textarea class="textarea" id="job-ai-question" placeholder="例如：这个岗位适合什么背景的人投？"></textarea>
              <button class="btn btn-secondary" id="job-ai-ask">发送追问</button>
            </div>
          </div>
        </div>
      </div>
      </div>
    `;
    document.getElementById('detail-source').href = job.source_url || '#';
    document.getElementById('detail-apply').href = job.apply_url || job.source_url || '#';
    document.getElementById('job-modal').classList.remove('hidden');

    const renderTimeline = () => {
      const current = readApplications()[job.id] || { timeline: [] };
      const container = document.getElementById('job-progress-timeline');
      container.innerHTML = (current.timeline || []).length ? current.timeline.map(item => `
        <article class="card" style="box-shadow:none;"><div class="card-body" style="padding:14px 16px;"><strong>${escapeHtml(item.title)}</strong><div class="text-muted" style="margin-top:8px;">${escapeHtml(item.time)}</div></div></article>
      `).join('') : '<div class="empty">还没有时间线记录</div>';
    };

    const renderHistory = (messages) => {
      const container = document.getElementById('job-ai-history');
      container.innerHTML = messages.length ? messages.map(item => `
        <article class="card" style="box-shadow:none;"><div class="card-body" style="padding:14px 16px;"><strong>${escapeHtml(item.role === 'user' ? '你' : 'AI')}</strong><div class="text-muted" style="margin-top:8px; white-space:pre-wrap;">${escapeHtml(item.content)}</div></div></article>
      `).join('') : '<div class="empty">还没有追问记录</div>';
    };

    document.getElementById('job-progress-save').addEventListener('click', () => {
      const payload = readApplications();
      const current = payload[job.id] || { status: '未投递', notes: '', timeline: [] };
      current.status = document.getElementById('job-progress-status').value;
      current.notes = document.getElementById('job-progress-notes').value.trim();
      payload[job.id] = current;
      writeApplications(payload);
      window.alert('岗位进度已保存到本地浏览器');
    });

    document.getElementById('job-progress-add').addEventListener('click', () => {
      const title = document.getElementById('job-progress-title').value.trim();
      if (!title) return;
      const payload = readApplications();
      const current = payload[job.id] || { status: '未投递', notes: '', timeline: [] };
      current.status = document.getElementById('job-progress-status').value;
      current.notes = document.getElementById('job-progress-notes').value.trim();
      current.timeline = [{ title, time: new Date().toLocaleString('zh-CN') }].concat(current.timeline || []).slice(0, 20);
      payload[job.id] = current;
      writeApplications(payload);
      document.getElementById('job-progress-title').value = '';
      renderTimeline();
    });

    document.getElementById('job-ai-run').addEventListener('click', async () => {
      const panel = document.getElementById('job-ai-analysis');
      panel.textContent = 'AI 正在分析当前岗位，请稍候...';
      try {
        const answer = await callAi([
          { role: 'system', content: '你是金融求职顾问，请根据岗位信息给出结构化、可执行的分析。' },
          { role: 'user', content: `请分析这个岗位的匹配方向、亮点、风险和投递建议。\n\n岗位名称：${job.title}\n公司：${job.company}\n地点：${job.location}\n岗位类型：${job.job_type}\n学历：${job.education}\n薪资：${job.salary}\n岗位描述：${job.description}\n任职要求：${job.requirements}` }
        ], {
          onToken(text) {
            panel.textContent = text || 'AI 正在生成内容...';
          }
        });
        panel.textContent = answer || 'AI 没有返回内容。';
      } catch (error) {
        panel.textContent = error.message || 'AI 分析失败';
      }
    });

    document.getElementById('job-ai-ask').addEventListener('click', async () => {
      const textarea = document.getElementById('job-ai-question');
      const question = textarea.value.trim();
      if (!question) return;
      const nextHistory = readAiChatHistory(chatScope).concat([{ role: 'user', content: question }]).slice(-12);
      writeAiChatHistory(chatScope, nextHistory);
      renderHistory(nextHistory.concat([{ role: 'assistant', content: 'AI 正在思考...' }]));
      textarea.value = '';
      try {
        const answer = await callAi([
          { role: 'system', content: '你是岗位问答助手，请围绕当前岗位回答用户的追问，保持简洁、有行动建议。' },
          { role: 'user', content: `岗位信息：${job.title} / ${job.company} / ${job.location} / ${job.job_type} / ${job.education}\n岗位描述：${job.description}\n岗位要求：${job.requirements}\n\n用户问题：${question}` }
        ]);
        const finalHistory = nextHistory.concat([{ role: 'assistant', content: answer || 'AI 没有返回内容。' }]).slice(-12);
        writeAiChatHistory(chatScope, finalHistory);
        renderHistory(finalHistory);
      } catch (error) {
        const finalHistory = nextHistory.concat([{ role: 'assistant', content: error.message || 'AI 追问失败' }]).slice(-12);
        writeAiChatHistory(chatScope, finalHistory);
        renderHistory(finalHistory);
      }
    });
  }

  function createJobCard(job, favorites) {
    const isFavorite = favorites.has(job.id);
    return `
      <article class="job-card card card-hover cursor-pointer" data-job-id="${job.id}">
        <div class="card-body p-5">
        <div class="job-head">
          <div>
            <h3 class="job-title text-lg font-semibold text-slate-900">${escapeHtml(job.title)}</h3>
            <div class="job-company text-sm text-slate-500 mt-1">${escapeHtml(job.company)} · ${escapeHtml(job.source || '未知来源')}</div>
          </div>
          <button class="btn ${isFavorite ? 'btn-soft' : 'btn-outline'} btn-sm" data-favorite-toggle="${job.id}">${isFavorite ? '已收藏' : '收藏'}</button>
        </div>
        <div class="job-meta mt-4">
          <span class="pill">${escapeHtml(job.location || '地点待定')}</span>
          <span class="pill">${escapeHtml(job.job_type || '类型待定')}</span>
          <span class="pill">${escapeHtml(job.education || '学历待定')}</span>
          <span class="pill">${escapeHtml(job.salary || '面议')}</span>
        </div>
        <div class="job-snippet mt-4 text-sm text-slate-600 leading-7">${escapeHtml((job.description || job.requirements || '暂无摘要').slice(0, 180))}</div>
        <div class="job-actions mt-4">
          <div class="text-muted">发布时间：${formatDate(job.publish_date || job.created_at)}</div>
          <div class="toolbar">
            <button class="btn btn-outline btn-sm" data-open-detail="${job.id}">查看详情</button>
            <a class="btn btn-primary btn-sm" href="${job.apply_url || job.source_url || '#'}" target="_blank" rel="noreferrer noopener">申请岗位</a>
          </div>
        </div>
        </div>
      </article>
    `;
  }

  function createLatestJobRow(job, favorites) {
    const isFavorite = favorites.has(job.id);
    return `
      <div class="p-6 border-b border-gray-200 last:border-b-0">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <h4 class="text-base font-semibold text-slate-900">${escapeHtml(job.title)}</h4>
              <span class="pill">${escapeHtml(job.job_type || '类型待定')}</span>
            </div>
            <div class="mt-2 text-sm text-slate-500">${escapeHtml(job.company || '未知公司')} · ${escapeHtml(job.location || '地点待定')} · ${escapeHtml(job.source || '未知来源')}</div>
            <div class="mt-3 text-sm text-slate-600 leading-7">${escapeHtml((job.description || job.requirements || '暂无摘要').slice(0, 120))}</div>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <button class="btn ${isFavorite ? 'btn-soft' : 'btn-outline'} btn-sm" data-favorite-toggle="${job.id}">${isFavorite ? '已收藏' : '收藏'}</button>
            <button class="btn btn-outline btn-sm" data-open-detail="${job.id}">查看详情</button>
          </div>
        </div>
      </div>
    `;
  }

  function bindJobActions(jobs, rerender) {
    document.querySelectorAll('[data-open-detail]').forEach(button => {
      button.addEventListener('click', () => {
        const id = Number(button.getAttribute('data-open-detail'));
        const job = jobs.find(item => item.id === id);
        if (job) openJobDetail(job);
      });
    });
    document.querySelectorAll('[data-favorite-toggle]').forEach(button => {
      button.addEventListener('click', () => {
        toggleFavorite(Number(button.getAttribute('data-favorite-toggle')));
        rerender();
      });
    });
  }

  function renderBarList(items) {
    if (!items || !items.length) return '<div class="empty">暂无统计数据</div>';
    const max = Math.max.apply(null, items.map(item => item.count).concat([1]));
    return `
      <div class="bar-list">
        ${items.map(item => `
          <div class="bar-item">
            <div>
              <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:8px;">
                <strong style="font-size:14px;">${escapeHtml(item.label)}</strong>
                <span class="text-muted">${item.count}</span>
              </div>
              <div class="bar-track"><div class="bar-fill" style="width:${(item.count / max) * 100}%"></div></div>
            </div>
            <strong style="text-align:right;">${item.count}</strong>
          </div>
        `).join('')}
      </div>
    `;
  }

  function scoreJob(job, profile) {
    let score = 0;
    const reasons = [];
    const text = [job.title, job.company, job.industry, job.category, job.description, job.requirements]
      .concat(job.tags || [])
      .join(' ')
      .toLowerCase();
    profile.keywords.forEach(keyword => {
      if (keyword && text.includes(keyword.toLowerCase())) {
        score += 18;
        reasons.push(`命中关键词“${keyword}”`);
      }
    });
    if (profile.location && (job.location || '').includes(profile.location)) {
      score += 14;
      reasons.push(`地点符合 ${profile.location}`);
    }
    if (profile.education && (job.education || '').includes(profile.education)) {
      score += 10;
      reasons.push('学历要求接近');
    }
    if (profile.jobType && job.job_type === profile.jobType) {
      score += 12;
      reasons.push('岗位类型匹配');
    }
    if (profile.industry && (job.industry || '').includes(profile.industry)) {
      score += 14;
      reasons.push('行业方向匹配');
    }
    const matchedSkills = (profile.skills || []).filter(skill => skill && text.includes(skill.toLowerCase()));
    if (matchedSkills.length) {
      score += Math.min(20, matchedSkills.length * 6);
      reasons.push(`技能匹配：${matchedSkills.join('、')}`);
    }
    return { score, reasons: reasons.slice(0, 4) };
  }

  function renderHome(snapshot) {
    const favorites = readFavorites();
    const applications = readApplications();
    const cards = [
      ['总岗位数', snapshot.stats.total_jobs, '数据实时更新', 'fas fa-briefcase', 'border-blue-100 bg-gradient-to-br from-blue-50 to-white', 'bg-blue-100 text-blue-600'],
      ['收藏岗位', favorites.size, '查看收藏', 'fas fa-star', 'border-violet-100 bg-gradient-to-br from-violet-50 to-white', 'bg-violet-100 text-violet-600', './favorites.html'],
      ['求职记录', Object.keys(applications).length, '本地保存的进度记录', 'fas fa-route', 'border-emerald-100 bg-gradient-to-br from-emerald-50 to-white', 'bg-emerald-100 text-emerald-600'],
      ['数据来源', snapshot.stats.sources_count, '管理数据源', 'fas fa-database', 'border-amber-100 bg-gradient-to-br from-amber-50 to-white', 'bg-amber-100 text-amber-600', './crawler.html'],
    ];
    const hotKeywords = snapshot.stats.top_categories.slice(0, 8).map(item => `
      <span class="pill">${escapeHtml(item.label)} · ${item.count}</span>
    `).join('');
    document.getElementById('page-root').innerHTML = `
      <section class="grid-cards">
        ${cards.map(([label, value, meta, icon, toneClass, iconClass, href]) => `
          <article class="card card-hover p-6 ${toneClass}">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-semibold text-slate-600 mb-1">${label}</p>
                <p class="metric-value text-3xl font-bold text-slate-900 tracking-tight" data-count="${value}">0</p>
              </div>
              <div class="stat-icon-wrapper ${iconClass}">
                <i class="${icon} text-xl"></i>
              </div>
            </div>
            <div class="mt-4 flex items-center text-sm ${href ? '' : 'text-slate-600'}">
              ${href ? `<a href="${href}" class="text-slate-700 hover:text-slate-900 transition font-medium">${meta} <i class="fas fa-arrow-right ml-1"></i></a>` : `<span>${meta}</span>`}
            </div>
          </article>
        `).join('')}
      </section>
      <section class="chart-wrap">
        <article class="card"><div class="card-header"><h3 class="section-title">来源分布</h3></div><div class="card-body">${renderBarList(snapshot.stats.top_sources.slice(0, 8))}</div></article>
        <article class="card"><div class="card-header"><h3 class="section-title">地点热度</h3></div><div class="card-body">${renderBarList(snapshot.stats.top_locations.slice(0, 8))}</div></article>
      </section>
      <section class="card">
        <div class="card-header"><div><h3 class="section-title">热门方向</h3><p class="text-muted">当前快照按岗位分类聚合的高频方向标签。</p></div></div>
        <div class="card-body"><div class="toolbar">${hotKeywords || '<div class="empty">暂无热门方向</div>'}</div></div>
      </section>
      <section class="card">
        <div class="card-header">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <i class="fas fa-clock text-blue-500"></i>
              <h3 class="text-lg font-semibold">最新岗位</h3>
            </div>
            <a href="./jobs.html" class="text-primary text-sm hover:underline">查看全部 <i class="fas fa-arrow-right"></i></a>
          </div>
        </div>
        <div class="card-body p-0"><div id="latest-jobs-list" class="divide-y divide-gray-200">${snapshot.jobs.slice(0, 8).map(job => createLatestJobRow(job, favorites)).join('')}</div></div>
        <div class="card-footer">
          <a href="./jobs.html" class="btn btn-primary w-full justify-center">
            <i class="fas fa-list"></i>
            浏览全部岗位
          </a>
        </div>
      </section>
    `;
    animateMetricNumbers();
    bindJobActions(snapshot.jobs, () => renderHome(snapshot));
  }

  function renderJobsPage(snapshot) {
    function uniqueValues(key) {
      return Array.from(new Set(snapshot.jobs.map(item => (item[key] || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    }
    document.getElementById('page-root').innerHTML = `
      <section id="filter-section" class="card mb-6 relative z-[70]" style="overflow: visible;">
        <div class="card-body">
          <div class="flex flex-wrap items-end gap-4">
            <div class="form-group mb-0">
              <label class="form-label">关键词</label>
              <input class="form-input w-56" id="keyword" placeholder="搜索岗位、公司、关键词">
            </div>
            <div class="form-group mb-0">
              <label class="form-label">工作地点</label>
              <select class="form-select w-40" id="location"><option value="">全部地点</option>${uniqueValues('location').map(v => `<option value="${v}">${v}</option>`).join('')}</select>
            </div>
            <div class="form-group mb-0">
              <label class="form-label">工作类型</label>
              <select class="form-select w-32" id="jobType"><option value="">全部类型</option>${uniqueValues('job_type').map(v => `<option value="${v}">${v}</option>`).join('')}</select>
            </div>
            <div class="form-group mb-0">
              <label class="form-label">行业赛道</label>
              <select class="form-select w-40" id="industry"><option value="">全部行业</option>${uniqueValues('industry').map(v => `<option value="${v}">${v}</option>`).join('')}</select>
            </div>
            <div class="form-group mb-0">
              <label class="form-label">学历要求</label>
              <select class="form-select w-32" id="education"><option value="">全部学历</option>${uniqueValues('education').map(v => `<option value="${v}">${v}</option>`).join('')}</select>
            </div>
            <button class="btn btn-ghost text-gray-600" id="clear-jobs-filters" type="button">
              <i class="fas fa-times-circle"></i> 清除筛选
            </button>
          </div>
        </div>
      </section>
      <section class="card">
        <div class="card-header"><div><h3 class="section-title">岗位列表</h3><p class="text-muted" id="jobs-summary"></p></div></div>
        <div class="card-body"><div class="jobs-grid" id="jobs-list"></div></div>
      </section>
    `;

    function rerender() {
      const keyword = document.getElementById('keyword').value.trim().toLowerCase();
      const location = document.getElementById('location').value;
      const jobType = document.getElementById('jobType').value;
      const industry = document.getElementById('industry').value;
      const education = document.getElementById('education').value;
      const jobs = snapshot.jobs.filter(job => {
        const joined = [job.title, job.company, job.description, job.requirements, job.category].concat(job.tags || []).join(' ').toLowerCase();
        if (keyword && !joined.includes(keyword)) return false;
        if (location && job.location !== location) return false;
        if (jobType && job.job_type !== jobType) return false;
        if (industry && job.industry !== industry) return false;
        if (education && job.education !== education) return false;
        return true;
      });
      document.getElementById('jobs-summary').textContent = `共筛出 ${jobs.length} 个岗位，按发布时间从新到旧排序。`;
      const favorites = readFavorites();
      document.getElementById('jobs-list').innerHTML = jobs.length ? jobs.map(job => createJobCard(job, favorites)).join('') : '<div class="empty">当前筛选条件下暂无岗位</div>';
      document.querySelectorAll('#jobs-list .job-card').forEach((node, index) => {
        node.style.animationDelay = `${Math.min(index * 40, 240)}ms`;
      });
      bindJobActions(snapshot.jobs, rerender);
    }

    ['keyword', 'location', 'jobType', 'industry', 'education'].forEach(id => {
      document.getElementById(id).addEventListener(id === 'keyword' ? 'input' : 'change', rerender);
    });
    document.getElementById('clear-jobs-filters').addEventListener('click', () => {
      ['keyword', 'location', 'jobType', 'industry', 'education'].forEach(id => {
        document.getElementById(id).value = '';
      });
      rerender();
    });
    rerender();
  }

  function renderFavoritesPage(snapshot) {
    function rerender() {
      const favorites = readFavorites();
      const jobs = snapshot.jobs.filter(job => favorites.has(job.id));
      document.getElementById('page-root').innerHTML = `
        <section class="card">
          <div class="card-header"><div><h3 class="section-title">已收藏岗位</h3><p class="text-muted">当前浏览器共保存 ${jobs.length} 个收藏岗位。</p></div></div>
          <div class="card-body"><div class="favorites-list">${jobs.length ? jobs.map(job => createJobCard(job, favorites)).join('') : '<div class="empty">你还没有收藏岗位，可以先去岗位列表看看。</div>'}</div></div>
          ${jobs.length ? '' : `<div class="card-footer"><a href="./jobs.html" class="btn btn-primary w-full justify-center"><i class="fas fa-list"></i> 去岗位列表看看</a></div>`}
        </section>
      `;
      document.querySelectorAll('.favorites-list .job-card').forEach((node, index) => {
        node.style.animationDelay = `${Math.min(index * 40, 240)}ms`;
      });
      bindJobActions(snapshot.jobs, rerender);
    }
    rerender();
  }

  function renderRecommendationsPage(snapshot) {
    document.getElementById('page-root').innerHTML = `
      <section class="grid grid-cols-1 xl:grid-cols-[minmax(360px,0.95fr)_minmax(0,1.45fr)] gap-6 items-start">
        <div class="card studio-panel-sticky sticky-panel">
          <div class="card-header"><div><h3 class="section-title">Recommendation Studio</h3><p class="text-muted">输入目标方向、地点、学历和技能，页面会先用本地规则完成初步推荐，再结合 AI 生成分析。</p></div></div>
          <div class="card-body">
            <div class="toolbar" style="flex-direction:column; align-items:stretch;">
              <input class="input" id="keywords" placeholder="关键词，多个请用逗号分隔">
              <input class="input" id="location" placeholder="目标地点，如 上海 / 北京">
              <input class="input" id="industry" placeholder="行业方向，如 基金/资管">
              <input class="input" id="jobType" placeholder="岗位类型，如 实习 / 校招">
              <input class="input" id="education" placeholder="学历要求，如 本科 / 硕士">
              <input class="input" id="skills" placeholder="技能标签，如 Python, SQL, 财务分析">
              <input class="input" id="resume-file-name" placeholder="可选：简历文件名（手动备注）">
              <textarea class="textarea" id="resume-text" placeholder="粘贴简历正文，AI 会结合这里的全部信息分析。"></textarea>
              <textarea class="textarea" id="notes" placeholder="附加说明，例如目标公司、希望岗位方向、特殊要求"></textarea>
              <button class="btn btn-primary" id="run-recommendation">生成推荐</button>
            </div>
          </div>
        </div>
        <div class="recommendation-workspace" style="display:grid; gap:20px;">
          <section class="card">
            <div class="card-header"><div><h3 class="section-title">推荐分析</h3><p class="text-muted" id="analysis-summary">填写画像后开始推荐。</p></div></div>
            <div class="card-body" id="analysis-panel"><div class="empty">等待生成推荐结果</div></div>
          </section>
          <section class="split-layout">
            <article class="card">
              <div class="card-header"><div><h3 class="section-title">AI 改简历建议</h3><p class="text-muted">结合当前画像和推荐岗位，生成更贴近投递场景的简历优化建议。</p></div></div>
              <div class="card-body">
                <div class="toolbar"><button class="btn btn-secondary" id="resume-advice-btn">生成简历建议</button></div>
                <div id="resume-advice-panel" class="text-muted" style="white-space:pre-wrap; line-height:1.9; min-height:80px; margin-top:12px;">点击后显示 AI 简历建议。</div>
              </div>
            </article>
            <article class="card">
              <div class="card-header"><div><h3 class="section-title">AI 投递助手</h3><p class="text-muted">自动生成投递建议、自我介绍和邮件正文草稿。</p></div></div>
              <div class="card-body">
                <div class="toolbar"><button class="btn btn-secondary" id="delivery-assistant-btn">生成投递助手内容</button></div>
                <div id="delivery-assistant-panel" class="text-muted" style="white-space:pre-wrap; line-height:1.9; min-height:80px; margin-top:12px;">点击后显示 AI 投递建议。</div>
              </div>
            </article>
          </section>
          <section class="card">
            <div class="card-header"><div><h3 class="section-title">推荐岗位</h3><p class="text-muted">按规则分数从高到低排列，可直接查看详情与收藏。</p></div></div>
            <div class="card-body"><div class="jobs-grid" id="recommend-list"><div class="empty">暂时还没有推荐结果</div></div></div>
          </section>
          <section class="split-layout">
            <article class="card"><div class="card-header"><h3 class="section-title">最近推荐历史</h3></div><div class="card-body" id="history-panel"></div></article>
            <article class="card">
              <div class="card-header"><div><h3 class="section-title">AI 追问式推荐</h3><p class="text-muted">可以围绕当前画像和推荐结果继续追问。</p></div></div>
              <div class="card-body">
                <div id="recommend-chat-history" class="history-list"></div>
                <div class="toolbar" style="margin-top:12px; flex-direction:column; align-items:stretch;">
                  <textarea class="textarea" id="recommend-chat-question" placeholder="例如：我更适合先投哪些岗位？哪些岗位更适合我的背景？"></textarea>
                  <button class="btn btn-secondary" id="recommend-chat-send">发送追问</button>
                </div>
              </div>
            </article>
          </section>
        </div>
      </section>
    `;

    function renderHistory() {
      const history = readHistory();
      document.getElementById('history-panel').innerHTML = history.length ? `<div class="history-list">${history.map(item => `
        <article class="card" style="box-shadow:none;"><div class="card-body" style="padding:16px 18px;"><strong>${escapeHtml(item.summary)}</strong><div class="text-muted" style="margin-top:8px;">${escapeHtml(item.time)}</div></div></article>
      `).join('')}</div>` : '<div class="empty">还没有推荐历史</div>';
    }

    function getProfilePayload() {
      return {
        keywords: document.getElementById('keywords').value.split(',').map(item => item.trim()).filter(Boolean),
        location: document.getElementById('location').value.trim(),
        industry: document.getElementById('industry').value.trim(),
        jobType: document.getElementById('jobType').value.trim(),
        education: document.getElementById('education').value.trim(),
        skills: document.getElementById('skills').value.split(',').map(item => item.trim()).filter(Boolean),
        resumeFileName: document.getElementById('resume-file-name').value.trim(),
        resumeText: document.getElementById('resume-text').value.trim(),
        notes: document.getElementById('notes').value.trim(),
      };
    }

    function renderRecommendChat() {
      const history = readAiChatHistory('recommendation-chat');
      document.getElementById('recommend-chat-history').innerHTML = history.length ? history.map(item => `
        <article class="card" style="box-shadow:none;"><div class="card-body" style="padding:14px 16px;"><strong>${escapeHtml(item.role === 'user' ? '你' : 'AI')}</strong><div class="text-muted" style="margin-top:8px; white-space:pre-wrap;">${escapeHtml(item.content)}</div></div></article>
      `).join('') : '<div class="empty">还没有 AI 对话记录</div>';
    }

    function rerender() {
      const profile = getProfilePayload();
      const scored = snapshot.jobs.map(job => ({ job, ...scoreJob(job, profile) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 12);
      const favorites = readFavorites();
      document.getElementById('recommend-list').innerHTML = scored.length ? scored.map(item => createJobCard(item.job, favorites)).join('') : '<div class="empty">当前画像下没有命中的岗位，建议放宽关键词或地点条件。</div>';
      document.querySelectorAll('#recommend-list .job-card').forEach((node, index) => {
        node.style.animationDelay = `${Math.min(index * 45, 270)}ms`;
      });
      const average = scored.length ? (scored.reduce((sum, item) => sum + item.score, 0) / scored.length).toFixed(1) : '0';
      document.getElementById('analysis-summary').textContent = `共命中 ${scored.length} 个岗位，平均匹配分 ${average}。`;
      document.getElementById('analysis-panel').innerHTML = scored.length ? `<div class="text-muted" style="line-height:1.9;">
        <p><strong>推荐结论：</strong>当前画像更适合 ${escapeHtml(profile.jobType || '通用')} 方向，重点关注 ${escapeHtml(profile.location || '地点不限')}、${escapeHtml(profile.industry || '行业不限')} 相关岗位。</p>
        <p><strong>匹配亮点：</strong>${escapeHtml((scored[0].reasons || []).join('；') || '主要依赖岗位标题与描述关键词匹配。')}</p>
        <p><strong>建议：</strong>${escapeHtml((profile.skills && profile.skills.length) ? `继续强化 ${profile.skills.slice(0, 3).join('、')} 等能力展示` : '补充技能标签会让推荐更精确')}，并优先查看前 5 个岗位详情。</p>
        <p><strong>简历信息：</strong>${escapeHtml(profile.resumeFileName || '未填写文件名')} ${profile.resumeText ? '· 已提供简历正文' : '· 未提供简历正文'}</p>
      </div>` : '<div class="empty">暂无命中结果</div>';
      pushHistory({
        id: String(Date.now()),
        summary: `关键词 ${profile.keywords.join(' / ') || '未填写'} · 命中 ${scored.length} 个岗位`,
        time: new Date().toLocaleString('zh-CN'),
      });
      renderHistory();
      bindJobActions(snapshot.jobs, rerender);
    }

    renderHistory();
    renderRecommendChat();
    document.getElementById('run-recommendation').addEventListener('click', rerender);
    document.getElementById('resume-advice-btn').addEventListener('click', async () => {
      const panel = document.getElementById('resume-advice-panel');
      const profile = getProfilePayload();
      const topJobs = snapshot.jobs.map(job => ({ job, ...scoreJob(job, profile) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
      panel.textContent = 'AI 正在生成简历建议...';
      try {
        const answer = await callAi([
          { role: 'system', content: '你是金融求职简历顾问，请输出结构化、可执行的简历优化建议。' },
          { role: 'user', content: `用户画像：关键词 ${profile.keywords.join('、')}；地点 ${profile.location}；行业 ${profile.industry}；岗位类型 ${profile.jobType}；学历 ${profile.education}；技能 ${profile.skills.join('、')}；附加说明 ${profile.notes}；简历正文 ${profile.resumeText}\n\n目标岗位：${topJobs.map(item => `${item.job.title} / ${item.job.company}`).join('；')}` }
        ], { onToken(text) { panel.textContent = text || 'AI 正在生成简历建议...'; } });
        panel.textContent = answer || 'AI 没有返回内容。';
      } catch (error) {
        panel.textContent = error.message || 'AI 简历建议失败';
      }
    });
    document.getElementById('delivery-assistant-btn').addEventListener('click', async () => {
      const panel = document.getElementById('delivery-assistant-panel');
      const profile = getProfilePayload();
      const topJob = snapshot.jobs.map(job => ({ job, ...scoreJob(job, profile) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score)[0];
      panel.textContent = 'AI 正在生成投递助手内容...';
      try {
        const answer = await callAi([
          { role: 'system', content: '你是岗位投递助手，请输出自我介绍、投递建议和邮件正文草稿。' },
          { role: 'user', content: `用户画像：关键词 ${profile.keywords.join('、')}；地点 ${profile.location}；行业 ${profile.industry}；岗位类型 ${profile.jobType}；学历 ${profile.education}；技能 ${profile.skills.join('、')}；附加说明 ${profile.notes}；简历正文 ${profile.resumeText}\n\n目标岗位：${topJob ? `${topJob.job.title} / ${topJob.job.company} / ${topJob.job.location}` : '暂无匹配岗位'}` }
        ], { onToken(text) { panel.textContent = text || 'AI 正在生成投递助手内容...'; } });
        panel.textContent = answer || 'AI 没有返回内容。';
      } catch (error) {
        panel.textContent = error.message || 'AI 投递助手失败';
      }
    });
    document.getElementById('recommend-chat-send').addEventListener('click', async () => {
      const textarea = document.getElementById('recommend-chat-question');
      const question = textarea.value.trim();
      if (!question) return;
      const profile = getProfilePayload();
      const nextHistory = readAiChatHistory('recommendation-chat').concat([{ role: 'user', content: question }]).slice(-12);
      writeAiChatHistory('recommendation-chat', nextHistory);
      renderRecommendChat();
      textarea.value = '';
      try {
        const topJobs = snapshot.jobs.map(job => ({ job, ...scoreJob(job, profile) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
        const answer = await callAi([
          { role: 'system', content: '你是求职推荐助手，请根据用户画像和已推荐岗位回答追问。' },
          { role: 'user', content: `用户画像：关键词 ${profile.keywords.join('、')}；地点 ${profile.location}；行业 ${profile.industry}；岗位类型 ${profile.jobType}；学历 ${profile.education}；技能 ${profile.skills.join('、')}；附加说明 ${profile.notes}；简历正文 ${profile.resumeText}\n\n当前推荐岗位：${topJobs.map(item => `${item.job.title}/${item.job.company}/${item.job.location}`).join('；')}\n\n用户问题：${question}` }
        ]);
        writeAiChatHistory('recommendation-chat', nextHistory.concat([{ role: 'assistant', content: answer || 'AI 没有返回内容。' }]).slice(-12));
        renderRecommendChat();
      } catch (error) {
        writeAiChatHistory('recommendation-chat', nextHistory.concat([{ role: 'assistant', content: error.message || 'AI 对话失败' }]).slice(-12));
        renderRecommendChat();
      }
    });
  }

  function renderSystemPage(snapshot) {
    const s = snapshot.stats;
    const subscriptions = readSubscriptions();
    const applications = readApplications();
    function metricCard(label, value, meta) {
      return `<article class="card metric-card"><div class="metric-label">${label}</div><div class="metric-value" data-count="${value}">0</div><div class="metric-meta">${meta}</div></article>`;
    }
    document.getElementById('page-root').innerHTML = `
      <section class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        ${metricCard('快照岗位数', s.total_jobs, '当前导出岗位总数')}
        ${metricCard('来源数量', s.sources_count, '不同学校与平台来源')}
        ${metricCard('订阅数量', subscriptions.length, '浏览器本地保存的岗位订阅')}
        ${metricCard('求职记录', Object.keys(applications).length, '本地保存的岗位进度与时间线')}
      </section>
      <section class="card">
        <div class="card-header"><h3 class="font-semibold">统一任务中心</h3></div>
        <div class="card-body">
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <article class="card" style="box-shadow:none;"><div class="card-body"><strong>岗位浏览</strong><div class="text-muted mt-2">支持筛选、收藏、详情与 AI 分析。</div></div></article>
            <article class="card" style="box-shadow:none;"><div class="card-body"><strong>智能推荐</strong><div class="text-muted mt-2">支持推荐、改简历、投递助手与 AI 追问。</div></div></article>
            <article class="card" style="box-shadow:none;"><div class="card-body"><strong>本地账号</strong><div class="text-muted mt-2">支持角色权限、本地登录与用户管理。</div></div></article>
            <article class="card" style="box-shadow:none;"><div class="card-body"><strong>采集监控</strong><div class="text-muted mt-2">保留任务记录、来源诊断和日志展示。</div></div></article>
          </div>
        </div>
      </section>
      <section class="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <article class="card"><div class="card-header"><h3 class="section-title">来源分布</h3></div><div class="card-body">${renderBarList(s.top_sources)}</div></article>
        <article class="card"><div class="card-header"><h3 class="section-title">岗位方向</h3></div><div class="card-body">${renderBarList(s.top_categories)}</div></article>
        <article class="card"><div class="card-header"><h3 class="section-title">行业赛道</h3></div><div class="card-body">${renderBarList(s.top_industries)}</div></article>
        <article class="card"><div class="card-header"><h3 class="section-title">地点热度</h3></div><div class="card-body">${renderBarList(s.top_locations)}</div></article>
      </section>
      <section class="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <article class="card">
          <div class="card-header"><div><h3 class="section-title">AI 配置中心</h3><p class="text-muted">使用浏览器端 fetch 直接调用 SiliconFlow，配置只保存在当前浏览器本地。</p></div></div>
          <div class="card-body">
            <div class="toolbar" style="flex-direction:column; align-items:stretch;">
              <input class="input" id="ai-base-url" value="${escapeHtml(readAiConfig().baseUrl)}" placeholder="API 地址">
              <input class="input" id="ai-model" value="${escapeHtml(readAiConfig().model)}" placeholder="模型名称">
              <input class="input" id="ai-fallback-models" value="${escapeHtml((readAiConfig().fallbackModels || []).join(','))}" placeholder="备用模型，逗号分隔">
              <input class="input" id="ai-api-key" value="${escapeHtml(readAiConfig().apiKey)}" placeholder="SiliconFlow API Key">
              <label class="pill" style="justify-content:flex-start;"><input type="checkbox" id="ai-stream" ${readAiConfig().useStream ? 'checked' : ''}> 流式输出</label>
              <button class="btn btn-primary" id="save-ai-config">保存 AI 配置</button>
            </div>
            <div id="ai-config-message" class="text-muted" style="margin-top:12px;">请注意：浏览器端保存密钥存在风险，建议只在个人本地环境使用。</div>
          </div>
        </article>
        <article class="card">
          <div class="card-header"><div><h3 class="section-title">功能说明</h3><p class="text-muted">这里已经迁移了除真实爬虫执行之外的大部分前端能力。</p></div></div>
          <div class="card-body text-muted" style="line-height:1.9;">
            <p>已迁移：岗位列表、详情弹窗、收藏、推荐、登录、用户管理、系统概览、数据采集监控台、本地记录、AI 配置与 AI 分析。</p>
            <p>未直接迁移：真实爬虫执行、服务端数据库写入、服务端安全鉴权。当前网页版会用本地数据、浏览器存储和浏览器直连 AI 的方式替代。</p>
          </div>
        </article>
      </section>
      <section class="grid grid-cols-1 xl:grid-cols-[0.95fr_1.05fr] gap-6">
        <article class="card">
          <div class="card-header"><div><h3 class="section-title">本地订阅提醒</h3><p class="text-muted">保存关键词、地点和类型偏好，页面会在这里维护订阅条件。</p></div></div>
          <div class="card-body">
            <div class="toolbar" style="flex-direction:column; align-items:stretch;">
              <input class="input" id="subscription-name" placeholder="订阅名称，例如 上海基金实习">
              <input class="input" id="subscription-keyword" placeholder="关键词，例如 基金, 投研">
              <input class="input" id="subscription-location" placeholder="地点，例如 上海">
              <input class="input" id="subscription-job-type" placeholder="岗位类型，例如 实习">
              <button class="btn btn-primary" id="save-subscription-btn">保存订阅</button>
            </div>
            <div id="subscription-list" class="history-list" style="margin-top:16px;">
              ${subscriptions.length ? subscriptions.map(item => `
                <article class="card" style="box-shadow:none;"><div class="card-body" style="padding:14px 16px; display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                  <div>
                    <strong>${escapeHtml(item.name)}</strong>
                    <div class="text-muted" style="margin-top:8px;">${escapeHtml(item.keyword || '无关键词')} · ${escapeHtml(item.location || '地点不限')} · ${escapeHtml(item.jobType || '类型不限')}</div>
                  </div>
                  <button class="btn btn-secondary" data-subscription-delete="${item.id}">删除</button>
                </div></article>
              `).join('') : '<div class="empty">还没有本地订阅</div>'}
            </div>
          </div>
        </article>
        <article class="card">
          <div class="card-header"><div><h3 class="section-title">本地任务中心</h3><p class="text-muted">把登录、推荐、投递记录和本地监控台串起来，形成完整的浏览器侧工作台。</p></div></div>
          <div class="card-body">
            <div class="history-list">
              <article class="card" style="box-shadow:none;"><div class="card-body" style="padding:14px 16px;"><strong>本地登录体系</strong><div class="text-muted" style="margin-top:8px;">支持本地账号、角色权限和用户管理。</div></div></article>
              <article class="card" style="box-shadow:none;"><div class="card-body" style="padding:14px 16px;"><strong>智能推荐 + AI</strong><div class="text-muted" style="margin-top:8px;">支持规则推荐、AI 改简历、AI 投递助手、岗位追问。</div></div></article>
              <article class="card" style="box-shadow:none;"><div class="card-body" style="padding:14px 16px;"><strong>岗位进度追踪</strong><div class="text-muted" style="margin-top:8px;">支持岗位进度、备注和时间线记录。</div></div></article>
            </div>
          </div>
        </article>
      </section>
    `;
    animateMetricNumbers();
    document.getElementById('save-ai-config').addEventListener('click', () => {
      writeAiConfig({
        baseUrl: document.getElementById('ai-base-url').value.trim(),
        model: document.getElementById('ai-model').value.trim(),
        fallbackModels: document.getElementById('ai-fallback-models').value.trim(),
        apiKey: document.getElementById('ai-api-key').value.trim(),
        useStream: document.getElementById('ai-stream').checked,
      });
      document.getElementById('ai-config-message').textContent = 'AI 配置已保存到当前浏览器本地。';
    });
    document.getElementById('save-subscription-btn').addEventListener('click', () => {
      const name = document.getElementById('subscription-name').value.trim();
      if (!name) {
        window.alert('请先填写订阅名称');
        return;
      }
      const next = readSubscriptions();
      next.unshift({
        id: Date.now(),
        name,
        keyword: document.getElementById('subscription-keyword').value.trim(),
        location: document.getElementById('subscription-location').value.trim(),
        jobType: document.getElementById('subscription-job-type').value.trim(),
      });
      writeSubscriptions(next);
      renderSystemPage(snapshot);
    });
    document.querySelectorAll('[data-subscription-delete]').forEach(button => {
      button.addEventListener('click', () => {
        const id = Number(button.getAttribute('data-subscription-delete'));
        writeSubscriptions(readSubscriptions().filter(item => Number(item.id) !== id));
        renderSystemPage(snapshot);
      });
    });
  }

  function renderCrawlerPage(snapshot) {
    const logs = readCrawlerLogs();
    const sourceList = (snapshot.stats.top_sources || []).slice(0, 10);

    function rerender() {
      const currentLogs = readCrawlerLogs();
      document.getElementById('page-root').innerHTML = `
        <section class="grid-cards">
          <article class="card metric-card"><div class="metric-label">可用岗位源</div><div class="metric-value" data-count="${snapshot.stats.sources_count || 0}">0</div><div class="metric-meta">来自最新数据快照的来源数量</div></article>
          <article class="card metric-card"><div class="metric-label">最近模拟任务</div><div class="metric-value" data-count="${currentLogs.length}">0</div><div class="metric-meta">仅保存在当前浏览器本地</div></article>
          <article class="card metric-card"><div class="metric-label">最新快照岗位</div><div class="metric-value" data-count="${snapshot.stats.total_jobs || 0}">0</div><div class="metric-meta">网页端不直接执行真实爬虫</div></article>
          <article class="card metric-card"><div class="metric-label">模拟状态</div><div class="metric-value" style="font-size:26px;">${currentLogs[0] ? escapeHtml(currentLogs[0].status) : 'idle'}</div><div class="metric-meta">展示监控体验和来源热度</div></article>
        </section>
        <section class="split-layout">
          <article class="card">
            <div class="card-header"><div><h3 class="section-title">采集监控面板</h3><p class="text-muted">网页端不直接运行 Playwright 爬虫，这里保留来源监控、任务记录和本地演示能力。</p></div></div>
            <div class="card-body">
              <div class="toolbar">
                <button class="btn btn-primary" id="mock-crawl-btn">生成一次模拟采集记录</button>
                <button class="btn btn-secondary" id="clear-crawl-btn">清空本地记录</button>
              </div>
              <div style="margin-top:18px;">${renderBarList(sourceList)}</div>
            </div>
          </article>
          <article class="card">
            <div class="card-header"><div><h3 class="section-title">任务日志</h3><p class="text-muted">保存在浏览器本地，方便演示数据采集监控台的样式与交互。</p></div></div>
            <div class="card-body">
              ${currentLogs.length ? `<div class="history-list">${currentLogs.map(item => `
                <article class="card" style="box-shadow:none;">
                  <div class="card-body" style="padding:16px 18px;">
                    <strong>${escapeHtml(item.title)}</strong>
                    <div class="text-muted" style="margin-top:8px;">${escapeHtml(item.message)}</div>
                    <div class="text-muted" style="margin-top:6px;">${escapeHtml(item.time)} · ${escapeHtml(item.status)}</div>
                  </div>
                </article>
              `).join('')}</div>` : '<div class="empty">还没有本地任务记录</div>'}
            </div>
          </article>
        </section>
      `;
      animateMetricNumbers();

      const mockBtn = document.getElementById('mock-crawl-btn');
      const clearBtn = document.getElementById('clear-crawl-btn');
      if (mockBtn) {
        mockBtn.addEventListener('click', () => {
          const topSource = sourceList[0] || { label: '本地来源', count: 0 };
          appendCrawlerLog({
            id: String(Date.now()),
            title: `模拟采集完成 · ${topSource.label}`,
            message: `已根据当前快照生成一条本地采集记录，当前来源样本数 ${topSource.count}。`,
            time: new Date().toLocaleString('zh-CN'),
            status: 'completed',
          });
          rerender();
        });
      }
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          writeCrawlerLogs([]);
          rerender();
        });
      }
    }

    rerender();
  }

  function renderUsersPage() {
    function rerender() {
      const users = readUsers();
      document.getElementById('page-root').innerHTML = `
        <section class="grid xl:grid-cols-[360px_1fr] gap-6">
          <article class="card">
            <div class="card-header"><h3 class="text-lg font-semibold">新建用户</h3></div>
            <div class="card-body space-y-4">
              <div>
                <label class="form-label">用户名</label>
                <input id="new-username" class="form-input" placeholder="例如 analyst01">
              </div>
              <div>
                <label class="form-label">显示名称</label>
                <input id="new-display-name" class="form-input" placeholder="例如 数据分析同学">
              </div>
              <div>
                <label class="form-label">角色</label>
                <select class="form-select" id="new-role">
                  <option value="viewer">viewer</option>
                  <option value="operator">operator</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <div>
                <label class="form-label">初始密码</label>
                <input id="new-password" type="password" class="form-input" placeholder="至少 8 位">
              </div>
              <button class="btn btn-primary w-full justify-center" id="create-user-btn">
                <i class="fas fa-user-plus"></i>
                创建用户
              </button>
            </div>
          </article>
          <article class="card">
            <div class="card-header flex items-center justify-between gap-4">
              <div>
                <h3 class="text-lg font-semibold">用户列表</h3>
                <p class="text-sm text-slate-500">支持在本地修改角色、停用和删除。</p>
              </div>
              <span class="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-3 py-1 text-sm font-semibold">${users.length}</span>
            </div>
            <div class="card-body">
              ${users.length ? `<div class="space-y-4">${users.map(user => `
                <article class="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
                  <div class="flex items-start justify-between gap-4 flex-wrap">
                    <div class="min-w-0">
                      <div class="flex items-center gap-3 flex-wrap">
                        <h4 class="text-lg font-semibold text-slate-900">${escapeHtml(user.display_name || user.username)}</h4>
                        <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${user.role === 'admin' ? 'bg-rose-50 text-rose-700 border border-rose-200' : user.role === 'operator' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-700 border border-slate-200'}">${escapeHtml(user.role)}</span>
                        ${user.is_active ? '<span class="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-3 py-1 text-xs font-semibold border border-emerald-200">启用中</span>' : '<span class="inline-flex items-center rounded-full bg-slate-100 text-slate-600 px-3 py-1 text-xs font-semibold border border-slate-200">已停用</span>'}
                      </div>
                      <div class="mt-2 text-sm text-slate-500">
                        <span>用户名：${escapeHtml(user.username)}</span>
                        <span class="mx-2 text-slate-300">|</span>
                        <span>最近登录：${escapeHtml(user.last_login_at || '暂无')}</span>
                      </div>
                    </div>
                    <div class="flex gap-2 flex-wrap">
                      <button class="btn btn-outline" data-user-edit="${user.id}"><i class="fas fa-pen"></i> 编辑</button>
                      ${user.username === 'admin' ? '' : `<button class="btn btn-outline text-rose-600 border-rose-200 hover:bg-rose-50" data-user-delete="${user.id}"><i class="fas fa-trash"></i> 删除</button>`}
                    </div>
                  </div>
                </article>
              `).join('')}</div>` : '<div class="hidden rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-slate-500" style="display:block;">暂无用户数据</div>'}
            </div>
          </article>
        </section>
      `;
      document.querySelectorAll('.history-list .card').forEach((node, index) => {
        node.style.animationDelay = `${Math.min(index * 60, 240)}ms`;
      });

      document.getElementById('create-user-btn').addEventListener('click', () => {
        const username = document.getElementById('new-username').value.trim();
        const displayName = document.getElementById('new-display-name').value.trim();
        const password = document.getElementById('new-password').value.trim();
        const role = document.getElementById('new-role').value;
        if (!username || !password) {
          window.alert('请填写用户名和密码');
          return;
        }
        const next = readUsers();
        if (next.some(item => item.username === username)) {
          window.alert('用户名已存在');
          return;
        }
        next.push({
          id: Date.now(),
          username,
          password,
          display_name: displayName || username,
          role,
          is_active: true,
          last_login_at: '',
        });
        writeUsers(next);
        rerender();
      });

      document.querySelectorAll('[data-user-edit]').forEach(button => {
        button.addEventListener('click', () => {
          const userId = Number(button.getAttribute('data-user-edit'));
          const usersData = readUsers();
          const target = usersData.find(item => Number(item.id) === userId);
          if (!target) return;
          const nextRole = window.prompt('请输入角色：admin / operator / viewer', target.role);
          if (nextRole === null) return;
          const activeText = window.prompt('是否启用账号？请输入 yes 或 no', target.is_active ? 'yes' : 'no');
          if (activeText === null) return;
          target.role = (nextRole || target.role).trim();
          target.is_active = /^y(es)?$/i.test(activeText.trim());
          writeUsers(usersData);
          rerender();
        });
      });

      document.querySelectorAll('[data-user-delete]').forEach(button => {
        button.addEventListener('click', () => {
          const userId = Number(button.getAttribute('data-user-delete'));
          const next = readUsers().filter(item => Number(item.id) !== userId);
          writeUsers(next);
          rerender();
        });
      });
    }

    rerender();
  }

  function renderLoginPage() {
    document.body.className = 'min-h-screen bg-slate-100';
    document.body.innerHTML = `
      <main class="min-h-screen flex items-center justify-center px-6 py-10">
        <div class="w-full max-w-5xl grid lg:grid-cols-[1.1fr_0.9fr] gap-8 items-stretch">
          <section class="rounded-[2rem] bg-slate-900 text-white p-10 shadow-2xl shadow-slate-900/20">
            <div class="inline-flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3">
              <div class="w-11 h-11 rounded-2xl bg-blue-500/90 flex items-center justify-center">
                <i class="fas fa-briefcase text-lg"></i>
              </div>
              <div>
                <div class="text-lg font-semibold">FinIntern Hub</div>
                <div class="text-sm text-slate-300">金融求职工作台</div>
              </div>
            </div>
            <h1 class="mt-8 text-4xl font-bold tracking-tight leading-tight">统一账号登录与权限体系</h1>
            <p class="mt-5 text-slate-300 leading-8 text-base">
              现在可以通过统一账号进入岗位列表、智能推荐、数据采集与系统状态，并按用户角色控制可见页面和管理权限。
            </p>
            <div class="mt-10 grid sm:grid-cols-2 gap-4">
              <div class="rounded-3xl border border-white/10 bg-white/5 p-5">
                <div class="text-sm text-slate-400">默认管理员</div>
                <div class="mt-2 font-semibold text-white">admin</div>
                <div class="mt-1 text-sm text-slate-300">首次登录后请立即修改密码</div>
              </div>
              <div class="rounded-3xl border border-white/10 bg-white/5 p-5">
                <div class="text-sm text-slate-400">权限模型</div>
                <div class="mt-2 font-semibold text-white">admin / operator / viewer</div>
                <div class="mt-1 text-sm text-slate-300">支持用户管理、采集管理、只读访问</div>
              </div>
            </div>
          </section>
          <section class="rounded-[2rem] bg-white p-8 shadow-xl shadow-slate-200/70 border border-white/80">
            <div class="flex items-center justify-between gap-4">
              <div>
                <h2 class="text-2xl font-bold text-slate-900">账号登录</h2>
                <p class="mt-2 text-sm text-slate-500">登录后可进入完整平台并按权限访问对应模块。</p>
              </div>
              <span class="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-3 py-1 text-sm font-semibold">v3.9.2</span>
            </div>
            <div class="mt-8 space-y-5">
              <div>
                <label class="form-label">用户名</label>
                <input id="login-username" class="form-input" placeholder="请输入用户名">
              </div>
              <div>
                <label class="form-label">密码</label>
                <input id="login-password" type="password" class="form-input" placeholder="请输入密码">
              </div>
              <div id="login-message" class="hidden rounded-2xl px-4 py-3 text-sm"></div>
              <button class="btn btn-primary w-full justify-center py-3 text-base" id="login-submit">
                <i class="fas fa-right-to-bracket"></i>
                登录并进入平台
              </button>
            </div>
            <div class="mt-8 rounded-3xl bg-slate-50 border border-slate-200 p-5">
              <div class="text-sm font-semibold text-slate-700">登录说明</div>
              <ul class="mt-3 space-y-2 text-sm text-slate-500 leading-7">
                <li>默认管理员账号会在首次打开时自动创建。</li>
                <li>管理员可在“用户管理”页面新增账号、分配角色、调整状态。</li>
                <li>未登录或权限不足时，页面会自动跳回登录页。</li>
              </ul>
            </div>
          </section>
        </div>
      </main>
    `;
    document.querySelectorAll('.card').forEach((node, index) => {
      node.style.animationDelay = `${index * 90}ms`;
    });
    readUsers();
    document.getElementById('login-submit').addEventListener('click', () => {
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      const target = readUsers().find(item => item.username === username && item.password === password && item.is_active);
      if (!target) {
        const msg = document.getElementById('login-message');
        msg.className = 'rounded-2xl px-4 py-3 text-sm bg-rose-50 text-rose-700 border border-rose-200';
        msg.textContent = '用户名或密码错误，或账号已停用。';
        msg.classList.remove('hidden');
        return;
      }
      target.last_login_at = new Date().toLocaleString('zh-CN');
      const users = readUsers().map(item => Number(item.id) === Number(target.id) ? target : item);
      writeUsers(users);
      setCurrentUser({
        id: target.id,
        username: target.username,
        display_name: target.display_name || target.username,
        role: target.role,
      });
      window.location.href = './index.html';
    });
  }

  function boot() {
    const page = document.body.getAttribute('data-page') || 'index';
    const snapshot = getSnapshot();
    const config = {
      index: ['index.html', '首页', '用纯 HTML / CSS / JS 浏览岗位概览、热点分布和最新岗位。'],
      jobs: ['jobs.html', '岗位列表', '从导出的数据快照中筛选与浏览岗位，不依赖后端接口即可运行。'],
      favorites: ['favorites.html', '本地收藏', '收藏信息只保存在当前浏览器本地。'],
      recommendations: ['recommendations.html', '智能推荐', '保留推荐体验，并在浏览器端直接接入 AI 能力。'],
      crawler: ['crawler.html', '数据采集台', '保留采集监控台的前端体验，用本地日志模拟任务记录与来源监控。'],
      system: ['system.html', '系统概览', '用快照方式展示来源、行业、地点和岗位类型分布。'],
      users: ['users.html', '用户管理', '在浏览器本地维护账号、角色和页面可见权限。'],
      login: ['login.html', '登录', '使用本地用户数据模拟账号登录与权限控制。'],
    };
    if (page === 'login') {
      renderLoginPage();
      return;
    }
    document.body.className = 'bg-gray-50 app-shell';
    if (!requirePermission(page === 'crawler' ? 'manage_crawler' : page === 'users' ? 'manage_users' : page === 'system' ? 'view_system' : page === 'recommendations' ? 'use_recommendations' : 'view_jobs')) {
      return;
    }
    const current = config[page] || config.index;
    document.body.innerHTML = createLayout(current[0], current[1], current[2]);
    bindSnapshotMeta(snapshot);
    bindDetailModal();
    if (page === 'jobs') renderJobsPage(snapshot);
    else if (page === 'favorites') renderFavoritesPage(snapshot);
    else if (page === 'recommendations') renderRecommendationsPage(snapshot);
    else if (page === 'crawler') renderCrawlerPage(snapshot);
    else if (page === 'system') renderSystemPage(snapshot);
    else if (page === 'users') renderUsersPage(snapshot);
    else renderHome(snapshot);
  }

  window.JobwebApp = { boot, logout };
})();
