export function renderBarList(items = []) {
  if (!items.length) {
    return `<div class="empty">暂无统计数据</div>`;
  }
  const max = Math.max(...items.map(item => item.count), 1);
  return `
    <div class="bar-list">
      ${items.map(item => `
        <div class="bar-item">
          <div>
            <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:8px;">
              <strong style="font-size:14px;">${item.label}</strong>
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
