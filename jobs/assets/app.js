const DATA_URL = './data/jobs.json';
const FAVORITES_KEY = 'jobweb-favorites';
const HISTORY_KEY = 'jobweb-recent-recommendations';

let snapshotCache = null;

export async function loadSnapshot() {
  if (snapshotCache) return snapshotCache;
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error('无法加载静态数据快照');
  snapshotCache = await response.json();
  return snapshotCache;
}

export function readFavorites() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

export function writeFavorites(set) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...set]));
}

export function toggleFavorite(id) {
  const favorites = readFavorites();
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  writeFavorites(favorites);
  return favorites;
}

export function readHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

export function pushHistory(entry) {
  const current = readHistory();
  const next = [entry, ...current.filter(item => item.id !== entry.id)].slice(0, 12);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
}

export function formatDate(value) {
  if (!value) return '未知时间';
  return String(value).slice(0, 10);
}

export function scoreJob(job, profile) {
  let score = 0;
  const reasons = [];
  const text = [job.title, job.company, job.industry, job.category, job.description, job.requirements, ...(job.tags || [])]
    .join(' ')
    .toLowerCase();

  for (const keyword of profile.keywords) {
    if (text.includes(keyword.toLowerCase())) {
      score += 18;
      reasons.push(`命中关键词“${keyword}”`);
    }
  }
  if (profile.location && job.location.includes(profile.location)) {
    score += 14;
    reasons.push(`地点符合 ${profile.location}`);
  }
  if (profile.education && job.education && job.education.includes(profile.education)) {
    score += 10;
    reasons.push(`学历要求与画像接近`);
  }
  if (profile.jobType && job.job_type === profile.jobType) {
    score += 12;
    reasons.push(`岗位类型匹配`);
  }
  if (profile.industry && job.industry.includes(profile.industry)) {
    score += 14;
    reasons.push(`行业方向相近`);
  }
  if ((profile.skills || []).length) {
    const matchedSkills = profile.skills.filter(skill => text.includes(skill.toLowerCase()));
    if (matchedSkills.length) {
      score += Math.min(20, matchedSkills.length * 6);
      reasons.push(`技能匹配：${matchedSkills.join('、')}`);
    }
  }
  return { score, reasons: reasons.slice(0, 4) };
}

export function createLayout(pageId, title, subtitle) {
  const links = [
    ['index.html', '首页', '⌂'],
    ['jobs.html', '岗位列表', '☰'],
    ['favorites.html', '我的收藏', '★'],
    ['recommendations.html', '智能推荐', '✦'],
    ['system.html', '系统概览', '◎'],
  ];

  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">J</div>
          <div class="brand-copy">
            <h1>jobweb</h1>
            <p>静态求职站点版本，适合本地预览与 GitHub Pages 部署。</p>
          </div>
        </div>
        <nav class="sidebar-nav">
          ${links.map(([href, label, icon]) => `
            <a class="nav-link ${pageId === href ? 'active' : ''}" href="./${href}">
              <span>${icon}</span>
              <span>${label}</span>
            </a>
          `).join('')}
        </nav>
        <div class="sidebar-meta">
          <div>版本：v3.11.1</div>
          <div>网站声明：仅为个人学习开发作用</div>
          <div>灵感来源：我们伟大的宝宝</div>
          <div>网站作者：JoakimStarr / 文人病</div>
        </div>
      </aside>
      <main class="content">
        <header class="topbar">
          <div>
            <h2>${title}</h2>
            <p>${subtitle}</p>
          </div>
          <div class="topbar-actions">
            <div class="badge" id="snapshot-meta">正在读取数据…</div>
          </div>
        </header>
        <div id="page-root"></div>
      </main>
    </div>
    <div class="detail-modal" id="detail-modal">
      <div class="detail-panel">
        <div class="card-header">
          <div>
            <h3 class="section-title" id="detail-title">岗位详情</h3>
            <div class="text-muted" id="detail-subtitle"></div>
          </div>
          <button class="btn btn-secondary" id="detail-close">关闭</button>
        </div>
        <div class="detail-scroll" id="detail-content"></div>
        <div class="detail-footer">
          <a class="btn btn-soft" id="detail-source" href="#" target="_blank" rel="noreferrer noopener">查看原网页</a>
          <a class="btn btn-primary" id="detail-apply" href="#" target="_blank" rel="noreferrer noopener">申请岗位</a>
        </div>
      </div>
    </div>
  `;
}

export function mountLayout(pageId, title, subtitle) {
  document.body.innerHTML = createLayout(pageId, title, subtitle);
}

export function bindSnapshotMeta(snapshot) {
  const meta = document.getElementById('snapshot-meta');
  if (!meta) return;
  meta.textContent = `快照时间 ${formatDate(snapshot.meta.generated_at)} · ${snapshot.meta.total_jobs} 个岗位`;
}

export function openJobDetail(job) {
  const modal = document.getElementById('detail-modal');
  document.getElementById('detail-title').textContent = job.title;
  document.getElementById('detail-subtitle').textContent = `${job.company} · ${job.location || '地点待定'} · ${job.source || '未知来源'}`;
  document.getElementById('detail-content').innerHTML = `
    <div class="two-col" style="margin-bottom:20px;">
      <div class="pill">发布时间：${formatDate(job.publish_date || job.created_at)}</div>
      <div class="pill">岗位类型：${job.job_type || '未知'}</div>
      <div class="pill">学历要求：${job.education || '未说明'}</div>
      <div class="pill">薪资：${job.salary || '面议'}</div>
    </div>
    <div class="card" style="box-shadow:none;">
      <div class="card-body">
        <h4 class="section-title">岗位描述</h4>
        <div class="text-muted" style="white-space:pre-wrap; line-height:1.9;">${escapeHtml(job.description || '暂无描述')}</div>
        <h4 class="section-title" style="margin-top:20px;">任职要求</h4>
        <div class="text-muted" style="white-space:pre-wrap; line-height:1.9;">${escapeHtml(job.requirements || '暂无要求')}</div>
      </div>
    </div>
  `;
  const source = document.getElementById('detail-source');
  const apply = document.getElementById('detail-apply');
  source.href = job.source_url || '#';
  apply.href = job.apply_url || job.source_url || '#';
  modal.classList.add('open');
}

export function bindDetailModal() {
  const modal = document.getElementById('detail-modal');
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) modal.classList.remove('open');
  });
  document.getElementById('detail-close')?.addEventListener('click', () => modal.classList.remove('open'));
}

export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function createJobCard(job, options = {}) {
  const favorites = options.favorites || readFavorites();
  const isFavorite = favorites.has(job.id);
  return `
    <article class="job-card" data-job-id="${job.id}">
      <div class="job-head">
        <div>
          <h3 class="job-title">${escapeHtml(job.title)}</h3>
          <div class="job-company">${escapeHtml(job.company)} · ${escapeHtml(job.source || '未知来源')}</div>
        </div>
        <button class="btn ${isFavorite ? 'btn-soft' : 'btn-secondary'}" data-favorite-toggle="${job.id}">
          ${isFavorite ? '已收藏' : '收藏'}
        </button>
      </div>
      <div class="job-meta">
        <span class="pill">${escapeHtml(job.location || '地点待定')}</span>
        <span class="pill">${escapeHtml(job.job_type || '类型待定')}</span>
        <span class="pill">${escapeHtml(job.education || '学历待定')}</span>
        <span class="pill">${escapeHtml(job.salary || '面议')}</span>
      </div>
      <div class="job-snippet">${escapeHtml((job.description || job.requirements || '暂无摘要').slice(0, 180))}</div>
      <div class="job-actions">
        <div class="text-muted">发布时间：${formatDate(job.publish_date || job.created_at)}</div>
        <div class="toolbar">
          <button class="btn btn-secondary" data-open-detail="${job.id}">查看详情</button>
          <a class="btn btn-primary" href="${job.apply_url || job.source_url || '#'}" target="_blank" rel="noreferrer noopener">申请岗位</a>
        </div>
      </div>
    </article>
  `;
}

export function bindJobCardInteractions(jobs, rerenderFavorites) {
  document.querySelectorAll('[data-open-detail]').forEach(button => {
    button.addEventListener('click', () => {
      const job = jobs.find(item => item.id === Number(button.dataset.openDetail));
      if (job) openJobDetail(job);
    });
  });
  document.querySelectorAll('[data-favorite-toggle]').forEach(button => {
    button.addEventListener('click', () => {
      toggleFavorite(Number(button.dataset.favoriteToggle));
      rerenderFavorites?.();
    });
  });
}

