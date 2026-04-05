import { bindDetailModal, bindSnapshotMeta, createJobCard, loadSnapshot, mountLayout, readFavorites, bindJobCardInteractions } from './app.js';
import { renderBarList } from './charts.js';

function renderMetrics(stats) {
  const cards = [
    ['总岗位数', stats.total_jobs, '静态快照内岗位总量'],
    ['数据来源', stats.sources_count, '按来源归档后的学校与平台数量'],
    ['收藏同步', readFavorites().size, '保存在浏览器本地'],
    ['岗位类型', stats.top_job_types.length, '已识别的岗位类型分布'],
  ];
  return `<section class="grid-cards">${cards.map(([label, value, meta]) => `
    <article class="card metric-card">
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value}</div>
      <div class="metric-meta">${meta}</div>
    </article>
  `).join('')}</section>`;
}

function renderHighlights(stats) {
  return `
    <section class="chart-wrap">
      <article class="card">
        <div class="card-header"><h3 class="section-title">来源分布</h3></div>
        <div class="card-body">${renderBarList(stats.top_sources.slice(0, 8))}</div>
      </article>
      <article class="card">
        <div class="card-header"><h3 class="section-title">地点热度</h3></div>
        <div class="card-body">${renderBarList(stats.top_locations.slice(0, 8))}</div>
      </article>
    </section>
  `;
}

function renderLatestJobs(jobs) {
  const favorites = readFavorites();
  return `
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="section-title">最新岗位</h3>
          <p class="text-muted">静态快照仍按发布时间倒序展示，可直接查看岗位详情与收藏。</p>
        </div>
      </div>
      <div class="card-body">
        <div class="jobs-grid" id="latest-jobs">${jobs.map(job => createJobCard(job, { favorites })).join('')}</div>
      </div>
    </section>
  `;
}

async function init() {
  mountLayout('index.html', '静态首页', '用纯 HTML / CSS / JS 浏览岗位概览、热点分布和最新岗位，适合直接部署到静态托管。');
  bindDetailModal();
  const snapshot = await loadSnapshot();
  bindSnapshotMeta(snapshot);
  const root = document.getElementById('page-root');
  root.innerHTML = [renderMetrics(snapshot.stats), renderHighlights(snapshot.stats), renderLatestJobs(snapshot.jobs.slice(0, 8))].join('');
  bindJobCardInteractions(snapshot.jobs, init);
}

init();
