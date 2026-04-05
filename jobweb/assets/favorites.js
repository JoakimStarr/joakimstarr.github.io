import { bindDetailModal, bindJobCardInteractions, bindSnapshotMeta, createJobCard, loadSnapshot, mountLayout, readFavorites } from './app.js';

async function init() {
  mountLayout('favorites.html', '本地收藏', '收藏信息只保存在当前浏览器本地，适合静态部署后的个人使用。');
  bindDetailModal();
  const snapshot = await loadSnapshot();
  bindSnapshotMeta(snapshot);
  const favorites = readFavorites();
  const jobs = snapshot.jobs.filter(job => favorites.has(job.id));
  document.getElementById('page-root').innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h3 class="section-title">已收藏岗位</h3>
          <p class="text-muted">当前浏览器共保存 ${jobs.length} 个收藏岗位。</p>
        </div>
      </div>
      <div class="card-body">
        <div class="favorites-list" id="favorites-list">
          ${jobs.length ? jobs.map(job => createJobCard(job, { favorites })).join('') : '<div class="empty">你还没有收藏岗位，可以先去岗位列表看看。</div>'}
        </div>
      </div>
    </section>
  `;
  bindJobCardInteractions(snapshot.jobs, init);
}

init();
