function parseAnimatedCounterValue(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return {
            value,
            prefix: '',
            suffix: '',
            decimals: Number.isInteger(value) ? 0 : 1,
        };
    }
    const text = String(value).trim();
    if (/\d+\.\d+\.\d+/.test(text)) {
        return null;
    }
    const matched = text.match(/^([^0-9\-]*)(-?\d+(?:\.\d+)?)(.*)$/);
    if (!matched) {
        return null;
    }
    const numeric = Number(matched[2]);
    if (!Number.isFinite(numeric)) {
        return null;
    }
    return {
        prefix: matched[1] || '',
        value: numeric,
        suffix: matched[3] || '',
        decimals: matched[2].includes('.') ? 1 : 0,
    };
}

function formatAnimatedCounterValue(value, options = {}) {
    const {
        prefix = '',
        suffix = '',
        decimals = 0,
        locale = 'zh-CN',
    } = options;
    const formatted = Number(value || 0).toLocaleString(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
    return `${prefix}${formatted}${suffix}`;
}

function renderAnimatedValue(value, className) {
    const descriptor = parseAnimatedCounterValue(value);
    if (!descriptor) {
        return `<div class="${className}">${escapeUiHtml(String(value ?? '-'))}</div>`;
    }
    return `
        <div class="${className}">
            <span
                class="count-rolling"
                data-countup="${descriptor.value}"
                data-countup-prefix="${escapeUiHtml(descriptor.prefix)}"
                data-countup-suffix="${escapeUiHtml(descriptor.suffix)}"
                data-countup-decimals="${descriptor.decimals}"
            >${escapeUiHtml(formatAnimatedCounterValue(descriptor.value, descriptor))}</span>
        </div>
    `;
}

function animateCountUp(element, targetValue, options = {}) {
    if (!element) return;
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const {
        duration = 860,
        decimals = 0,
        prefix = '',
        suffix = '',
        locale = 'zh-CN',
    } = options;
    const finalValue = Number(targetValue || 0);
    if (!Number.isFinite(finalValue)) {
        element.textContent = `${prefix}${targetValue ?? ''}${suffix}`;
        return;
    }
    const previous = Number(element.dataset.countupCurrent ?? 0);
    const startValue = Number.isFinite(previous) ? previous : 0;
    element.dataset.countupCurrent = String(finalValue);
    if (reduceMotion) {
        element.textContent = formatAnimatedCounterValue(finalValue, { prefix, suffix, decimals, locale });
        return;
    }

    const startedAt = performance.now();
    element.classList.add('is-animating');

    function tick(now) {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 4);
        const current = startValue + (finalValue - startValue) * eased;
        element.textContent = formatAnimatedCounterValue(current, { prefix, suffix, decimals, locale });
        if (progress < 1) {
            requestAnimationFrame(tick);
            return;
        }
        element.textContent = formatAnimatedCounterValue(finalValue, { prefix, suffix, decimals, locale });
        element.classList.remove('is-animating');
    }

    requestAnimationFrame(tick);
}

function animateCountUpIn(root = document) {
    const container = root && typeof root.querySelectorAll === 'function' ? root : document;
    container.querySelectorAll('[data-countup]').forEach((element) => {
        animateCountUp(element, Number(element.dataset.countup || 0), {
            prefix: element.dataset.countupPrefix || '',
            suffix: element.dataset.countupSuffix || '',
            decimals: Number(element.dataset.countupDecimals || 0),
            duration: Number(element.dataset.countupDuration || 860),
        });
    });
}

function renderMetricCard({ label, value, icon = 'fa-chart-simple', tone = 'blue', hint = '' }) {
    const tones = {
        blue: 'bg-blue-50 text-blue-600',
        emerald: 'bg-emerald-50 text-emerald-600',
        amber: 'bg-amber-50 text-amber-600',
        rose: 'bg-rose-50 text-rose-600',
        violet: 'bg-violet-50 text-violet-600',
        slate: 'bg-slate-100 text-slate-700',
    };
    const toneClass = tones[tone] || tones.blue;
    const accentMap = {
        blue: 'from-blue-500/20 to-cyan-400/10',
        emerald: 'from-emerald-500/20 to-lime-400/10',
        amber: 'from-amber-500/20 to-orange-400/10',
        rose: 'from-rose-500/20 to-pink-400/10',
        violet: 'from-violet-500/20 to-fuchsia-400/10',
        slate: 'from-slate-500/20 to-slate-300/10',
    };
    return `
        <div class="card reveal-up motion-card overflow-hidden" data-view-card="metric">
            <div class="card-body flex items-center justify-between gap-4 relative">
                <div class="absolute inset-x-0 top-0 h-24 bg-gradient-to-r ${accentMap[tone] || accentMap.blue} metric-visual"></div>
                <div class="relative">
                    <div class="text-sm text-gray-500">${escapeUiHtml(label)}</div>
                    ${renderAnimatedValue(value, 'text-2xl font-bold text-gray-900 mt-1')}
                    ${hint ? `<div class="text-xs text-gray-500 mt-2">${escapeUiHtml(hint)}</div>` : ''}
                </div>
                <div class="relative flex flex-col items-end gap-3">
                    <div class="w-12 h-12 rounded-2xl ${toneClass} flex items-center justify-center shadow-sm"><i class="fas ${icon}"></i></div>
                    <div class="metric-visual flex items-end gap-1 h-10">
                        <span class="w-2 rounded-full bg-current opacity-30" style="height:35%"></span>
                        <span class="w-2 rounded-full bg-current opacity-50" style="height:58%"></span>
                        <span class="w-2 rounded-full bg-current opacity-70" style="height:82%"></span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderTaskItem(task) {
    const statusMap = {
        healthy: 'bg-emerald-50 text-emerald-700',
        running: 'bg-blue-50 text-blue-700',
        active: 'bg-violet-50 text-violet-700',
        idle: 'bg-slate-100 text-slate-700',
        disabled: 'bg-amber-50 text-amber-700',
        error: 'bg-rose-50 text-rose-700',
    };
    const badgeClass = statusMap[task.status] || statusMap.idle;
    const meta = (task.meta || []).map(item => `<div class="text-xs text-gray-500">${escapeUiHtml(item)}</div>`).join('');
    return `
        <div class="rounded-3xl border border-gray-200 bg-white/80 p-4 shadow-sm reveal-up motion-card" data-view-card="task">
            <div class="flex items-center justify-between gap-3">
                <div class="font-semibold text-gray-900">${escapeUiHtml(task.name || '未命名任务')}</div>
                <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${badgeClass}">${escapeUiHtml(task.status || 'idle')}</span>
            </div>
            <div class="task-visual mt-4 grid grid-cols-4 gap-2">
                <div class="h-2 rounded-full bg-slate-200 overflow-hidden col-span-3">
                    <div class="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400" style="width:${task.status === 'running' ? 82 : task.status === 'healthy' ? 100 : task.status === 'active' ? 64 : task.status === 'disabled' ? 28 : 42}%"></div>
                </div>
                <div class="text-[11px] text-gray-400 text-right">${escapeUiHtml(task.status || 'idle')}</div>
            </div>
            <div class="text-sm text-gray-700 mt-3 leading-6">${escapeUiHtml(task.summary || '暂无说明')}</div>
            <div class="space-y-1 mt-3">${meta || '<div class="text-xs text-gray-400">暂无附加信息</div>'}</div>
        </div>
    `;
}

function renderPanelState({ title, body, tone = 'slate', icon = 'fa-circle-info' }) {
    const tones = {
        slate: 'border-slate-200 bg-slate-50 text-slate-700',
        sky: 'border-sky-200 bg-sky-50 text-sky-700',
        amber: 'border-amber-200 bg-amber-50 text-amber-700',
        rose: 'border-rose-200 bg-rose-50 text-rose-700',
    };
    return `
        <div class="rounded-2xl border ${tones[tone] || tones.slate} p-5">
            <div class="flex items-center gap-2 font-semibold"><i class="fas ${icon}"></i><span>${escapeUiHtml(title)}</span></div>
            <div class="text-sm leading-6 mt-3">${escapeUiHtml(body)}</div>
        </div>
    `;
}

function renderVisualRing({ label, value, total, tone = 'blue', caption = '', icon = 'fa-chart-pie' }) {
    const safeTotal = Math.max(Number(total) || 0, 1);
    const safeValue = Math.max(0, Number(value) || 0);
    const percent = Math.min(100, Math.round((safeValue / safeTotal) * 100));
    const colors = {
        blue: ['#2563eb', '#60a5fa'],
        emerald: ['#059669', '#34d399'],
        amber: ['#d97706', '#fbbf24'],
        rose: ['#e11d48', '#fb7185'],
        violet: ['#7c3aed', '#c084fc'],
        slate: ['#475569', '#94a3b8'],
    };
    const [primary, secondary] = colors[tone] || colors.blue;
    const style = `background: conic-gradient(${primary} 0deg, ${secondary} ${percent * 3.6}deg, rgba(148,163,184,0.18) ${percent * 3.6}deg 360deg);`;
    return `
        <div class="rounded-[28px] border border-gray-200 bg-white/80 p-5 shadow-sm reveal-up motion-card view-visual-only">
            <div class="flex items-center justify-between gap-3">
                <div>
                    <div class="text-sm text-gray-500">${escapeUiHtml(label)}</div>
                    ${renderAnimatedValue(value, 'text-2xl font-bold text-gray-900 mt-2')}
                    ${caption ? `<div class="text-xs text-gray-500 mt-2">${escapeUiHtml(caption)}</div>` : ''}
                </div>
                <div class="w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-sm" style="background: linear-gradient(135deg, ${primary}, ${secondary});">
                    <i class="fas ${icon}"></i>
                </div>
            </div>
            <div class="mt-5 flex items-center gap-4">
                <div class="relative w-24 h-24 shrink-0 rounded-full motion-visual-ring" style="${style}">
                    <div class="absolute inset-[10px] rounded-full bg-white/95 flex items-center justify-center text-sm font-semibold text-gray-900">
                        <span class="count-rolling" data-countup="${percent}" data-countup-suffix="%">${percent}%</span>
                    </div>
                </div>
                <div class="flex-1">
                    <div class="text-sm text-gray-600 leading-6">占比 <span class="count-rolling" data-countup="${percent}" data-countup-suffix="%">${percent}%</span></div>
                    <div class="mt-3 h-3 rounded-full bg-slate-100 overflow-hidden">
                        <div class="h-full rounded-full" style="width:${percent}%; background: linear-gradient(90deg, ${primary}, ${secondary});"></div>
                    </div>
                    <div class="mt-2 text-xs text-gray-500">基于总量 <span class="count-rolling" data-countup="${safeTotal}">${escapeUiHtml(String(total))}</span> 计算</div>
                </div>
            </div>
        </div>
    `;
}

function renderVisualBarPanel({ title, items = [], tone = 'blue', emptyText = '暂无可视化数据', icon = 'fa-chart-column' }) {
    const colors = {
        blue: ['#2563eb', '#60a5fa'],
        emerald: ['#059669', '#34d399'],
        amber: ['#d97706', '#fbbf24'],
        rose: ['#e11d48', '#fb7185'],
        violet: ['#7c3aed', '#c084fc'],
        slate: ['#475569', '#94a3b8'],
    };
    const [primary, secondary] = colors[tone] || colors.blue;
    const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
    const maxValue = Math.max(...safeItems.map(item => Number(item.value) || 0), 1);
    const body = safeItems.length
        ? safeItems.map(item => {
            const value = Number(item.value) || 0;
            const width = Math.max(8, Math.round((value / maxValue) * 100));
            return `
                <div class="space-y-2">
                    <div class="flex items-center justify-between gap-3 text-sm">
                        <span class="font-medium text-gray-700">${escapeUiHtml(item.label || '未命名')}</span>
                        <span class="text-gray-500 count-rolling" data-countup="${value}">${escapeUiHtml(String(value))}</span>
                    </div>
                    <div class="h-3 rounded-full bg-slate-100 overflow-hidden">
                        <div class="h-full rounded-full" style="width:${width}%; background: linear-gradient(90deg, ${primary}, ${secondary});"></div>
                    </div>
                </div>
            `;
        }).join('')
        : `<div class="text-sm text-gray-500">${escapeUiHtml(emptyText)}</div>`;

    return `
        <div class="rounded-[28px] border border-gray-200 bg-white/80 p-5 shadow-sm reveal-up motion-card view-visual-only">
            <div class="flex items-center justify-between gap-3 mb-5">
                <div>
                    <div class="text-base font-semibold text-gray-900">${escapeUiHtml(title)}</div>
                    <div class="text-xs text-gray-500 mt-1">图形化显示当前数据分布</div>
                </div>
                <div class="w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-sm" style="background: linear-gradient(135deg, ${primary}, ${secondary});">
                    <i class="fas ${icon}"></i>
                </div>
            </div>
            <div class="space-y-4">${body}</div>
        </div>
    `;
}

function escapeUiHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

window.animateCountUp = animateCountUp;
window.animateCountUpIn = animateCountUpIn;
