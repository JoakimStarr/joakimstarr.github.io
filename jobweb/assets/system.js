import { bindSnapshotMeta, loadSnapshot, mountLayout } from './app.js';
import { renderBarList } from './charts.js';

function metricCard(label, value, meta) {
  return `
    <article class="card metric-card">
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value}</div>
      <div class="metric-meta">${meta}</div>
    </article>
  `;
}

async function init() {
  mountLayout('system.html', '静态系统概览', '用快照方式展示来源、行业、地点和岗位类型分布，适合部署为零后端页面。');
  const snapshot = await loadSnapshot();
  bindSnapshotMeta(snapshot);
  const stats = snapshot.stats;
  document.getElementById('page-root').innerHTML = `
    <section class="grid-cards">
      ${metricCard('快照岗位数', stats.total_jobs, '导出的静态岗位总数')}
      ${metricCard('来源数量', stats.sources_count, '不同学校与平台来源')}
      ${metricCard('行业分类', stats.top_industries.length, '已识别行业赛道')}
      ${metricCard('岗位类型', stats.top_job_types.length, '静态识别的类型枚举')}
    </section>
    <section class="chart-wrap">
      <article class="card">
        <div class="card-header"><h3 class="section-title">来源分布</h3></div>
        <div class="card-body">${renderBarList(stats.top_sources)}</div>
      </article>
      <article class="card">
        <div class="card-header"><h3 class="section-title">岗位方向</h3></div>
        <div class="card-body">${renderBarList(stats.top_categories)}</div>
      </article>
      <article class="card">
        <div class="card-header"><h3 class="section-title">行业赛道</h3></div>
        <div class="card-body">${renderBarList(stats.top_industries)}</div>
      </article>
      <article class="card">
        <div class="card-header"><h3 class="section-title">地点热度</h3></div>
        <div class="card-body">${renderBarList(stats.top_locations)}</div>
      </article>
    </section>
  `;
}

init();
