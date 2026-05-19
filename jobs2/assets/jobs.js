import { bindDetailModal, bindJobCardInteractions, bindSnapshotMeta, createJobCard, loadSnapshot, mountLayout, readFavorites } from './app.js';

let snapshot;
let filteredJobs = [];

function uniqueValues(key) {
  return [...new Set(snapshot.jobs.map(item => (item[key] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function renderFilters() {
  return `
    <section class="card">
      <div class="card-body">
        <div class="filters">
          <input class="input" id="keyword" placeholder="搜索岗位、公司、关键词">
          <select class="select" id="location"><option value="">全部地点</option>${uniqueValues('location').map(v => `<option value="${v}">${v}</option>`).join('')}</select>
          <select class="select" id="jobType"><option value="">全部类型</option>${uniqueValues('job_type').map(v => `<option value="${v}">${v}</option>`).join('')}</select>
          <select class="select" id="industry"><option value="">全部行业</option>${uniqueValues('industry').map(v => `<option value="${v}">${v}</option>`).join('')}</select>
          <select class="select" id="education"><option value="">全部学历</option>${uniqueValues('education').map(v => `<option value="${v}">${v}</option>`).join('')}</select>
        </div>
      </div>
    </section>
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="section-title">岗位列表</h3>
          <p class="text-muted" id="jobs-summary"></p>
        </div>
      </div>
      <div class="card-body">
        <div class="jobs-grid" id="jobs-list"></div>
      </div>
    </section>
  `;
}

function applyFilters() {
  const keyword = document.getElementById('keyword').value.trim().toLowerCase();
  const location = document.getElementById('location').value;
  const jobType = document.getElementById('jobType').value;
  const industry = document.getElementById('industry').value;
  const education = document.getElementById('education').value;

  filteredJobs = snapshot.jobs.filter(job => {
    const joined = [job.title, job.company, job.description, job.requirements, job.category, ...(job.tags || [])].join(' ').toLowerCase();
    if (keyword && !joined.includes(keyword)) return false;
    if (location && job.location !== location) return false;
    if (jobType && job.job_type !== jobType) return false;
    if (industry && job.industry !== industry) return false;
    if (education && job.education !== education) return false;
    return true;
  });
  renderJobs();
}

function renderJobs() {
  const favorites = readFavorites();
  document.getElementById('jobs-summary').textContent = `共筛出 ${filteredJobs.length} 个岗位，仍按发布时间从新到旧排序。`;
  document.getElementById('jobs-list').innerHTML = filteredJobs.length
    ? filteredJobs.map(job => createJobCard(job, { favorites })).join('')
    : `<div class="empty">当前筛选条件下暂无岗位</div>`;
  bindJobCardInteractions(snapshot.jobs, renderJobs);
}

async function init() {
  mountLayout('jobs.html', '静态岗位列表', '从导出的 JSON 快照中筛选与浏览岗位，不依赖后端接口即可运行。');
  bindDetailModal();
  snapshot = await loadSnapshot();
  bindSnapshotMeta(snapshot);
  document.getElementById('page-root').innerHTML = renderFilters();
  filteredJobs = [...snapshot.jobs];
  renderJobs();
  ['keyword', 'location', 'jobType', 'industry', 'education'].forEach(id => {
    document.getElementById(id).addEventListener(id === 'keyword' ? 'input' : 'change', applyFilters);
  });
}

init();
