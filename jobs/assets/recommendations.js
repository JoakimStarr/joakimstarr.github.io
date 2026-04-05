import { bindDetailModal, bindJobCardInteractions, bindSnapshotMeta, createJobCard, loadSnapshot, mountLayout, pushHistory, readFavorites, readHistory, scoreJob } from './app.js';

let snapshot;
let recommendedJobs = [];

function renderPage() {
  return `
    <section class="recommend-grid">
      <div class="card sticky-panel">
        <div class="card-header">
          <div>
            <h3 class="section-title">Recommendation Studio</h3>
            <p class="text-muted">输入你的目标方向、地点、学历和技能，静态页会用本地规则完成初步推荐。</p>
          </div>
        </div>
        <div class="card-body">
          <div class="toolbar" style="flex-direction:column; align-items:stretch;">
            <input class="input" id="keywords" placeholder="关键词，多个请用逗号分隔">
            <input class="input" id="location" placeholder="目标地点，如 上海 / 北京">
            <input class="input" id="industry" placeholder="行业方向，如 基金/资管">
            <input class="input" id="jobType" placeholder="岗位类型，如 实习 / 校招">
            <input class="input" id="education" placeholder="学历要求，如 本科 / 硕士">
            <input class="input" id="skills" placeholder="技能标签，如 Python, SQL, 财务分析">
            <textarea class="textarea" id="notes" placeholder="附加说明，例如目标公司、希望岗位方向、特殊要求"></textarea>
            <button class="btn btn-primary" id="run-recommendation">生成推荐</button>
          </div>
        </div>
      </div>

      <div style="display:grid; gap:20px;">
        <section class="card">
          <div class="card-header">
            <div>
              <h3 class="section-title">推荐分析</h3>
              <p class="text-muted" id="analysis-summary">填写画像后开始推荐。</p>
            </div>
          </div>
          <div class="card-body" id="analysis-panel">
            <div class="empty">等待生成推荐结果</div>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <div>
              <h3 class="section-title">推荐岗位</h3>
              <p class="text-muted">按规则分数从高到低排列，可直接查看详情与收藏。</p>
            </div>
          </div>
          <div class="card-body">
            <div class="jobs-grid" id="recommend-list">
              <div class="empty">暂时还没有推荐结果</div>
            </div>
          </div>
        </section>

        <section class="split-layout">
          <article class="card">
            <div class="card-header"><h3 class="section-title">最近推荐历史</h3></div>
            <div class="card-body" id="history-panel"></div>
          </article>
          <article class="card">
            <div class="card-header"><h3 class="section-title">静态页说明</h3></div>
            <div class="card-body text-muted" style="line-height:1.9;">
              这个静态版本不调用在线 AI，只使用浏览器里的规则评分来完成第一轮推荐。适合 GitHub Pages、本地离线预览，后续也可以再接入云端接口。
            </div>
          </article>
        </section>
      </div>
    </section>
  `;
}

function renderHistory() {
  const history = readHistory();
  document.getElementById('history-panel').innerHTML = history.length
    ? `<div class="history-list">${history.map(item => `
        <article class="card" style="box-shadow:none;">
          <div class="card-body" style="padding:16px 18px;">
            <strong>${item.summary}</strong>
            <div class="text-muted" style="margin-top:8px;">${item.time}</div>
          </div>
        </article>
      `).join('')}</div>`
    : '<div class="empty">还没有推荐历史</div>';
}

function runRecommendation() {
  const profile = {
    keywords: document.getElementById('keywords').value.split(',').map(item => item.trim()).filter(Boolean),
    location: document.getElementById('location').value.trim(),
    industry: document.getElementById('industry').value.trim(),
    jobType: document.getElementById('jobType').value.trim(),
    education: document.getElementById('education').value.trim(),
    skills: document.getElementById('skills').value.split(',').map(item => item.trim()).filter(Boolean),
    notes: document.getElementById('notes').value.trim(),
  };

  const scored = snapshot.jobs
    .map(job => ({ job, ...scoreJob(job, profile) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  recommendedJobs = scored.map(item => item.job);
  const favorites = readFavorites();
  document.getElementById('recommend-list').innerHTML = recommendedJobs.length
    ? recommendedJobs.map(job => createJobCard(job, { favorites })).join('')
    : '<div class="empty">当前画像下没有命中的岗位，建议放宽关键词或地点条件。</div>';

  const total = scored.reduce((sum, item) => sum + item.score, 0);
  const average = scored.length ? (total / scored.length).toFixed(1) : '0';
  document.getElementById('analysis-summary').textContent = `共命中 ${scored.length} 个岗位，平均匹配分 ${average}。`;
  document.getElementById('analysis-panel').innerHTML = scored.length
    ? `
      <div class="text-muted" style="line-height:1.9;">
        <p><strong>推荐结论：</strong>当前画像更适合 ${profile.jobType || '通用'} 方向，重点关注 ${profile.location || '地点不限'}、${profile.industry || '行业不限'} 相关岗位。</p>
        <p><strong>匹配亮点：</strong>${scored[0].reasons.join('；') || '主要依赖岗位标题与描述关键词匹配。'}</p>
        <p><strong>建议：</strong>${profile.skills.length ? `继续强化 ${profile.skills.slice(0, 3).join('、')} 等能力展示` : '补充技能标签会让推荐更精确'}，并优先查看前 5 个岗位详情。</p>
      </div>
    `
    : '<div class="empty">暂无命中结果</div>';

  pushHistory({
    id: `${Date.now()}`,
    summary: `关键词 ${profile.keywords.join(' / ') || '未填写'} · 命中 ${scored.length} 个岗位`,
    time: new Date().toLocaleString('zh-CN'),
  });
  renderHistory();
  bindJobCardInteractions(snapshot.jobs, runRecommendation);
}

async function init() {
  mountLayout('recommendations.html', '静态智能推荐', '保留核心推荐体验，用纯前端规则在静态页面里完成初步匹配与历史记录保存。');
  bindDetailModal();
  snapshot = await loadSnapshot();
  bindSnapshotMeta(snapshot);
  document.getElementById('page-root').innerHTML = renderPage();
  renderHistory();
  document.getElementById('run-recommendation').addEventListener('click', runRecommendation);
}

init();
