// Income Expenditure View — income streams flowing into expenditure via a
// hand-drawn SVG ribbon diagram. Expenditure can be grouped by Category or
// Necessity Level. A red "Deficit" node appears when spending exceeds income.

import * as api from '../api.js';
import * as store from '../store.js';
import * as charts from '../charts.js';
import { getMeta, toast } from '../app.js';

const W = 1000;
const LABEL_W = 208;
const BAR_W = 22;
const NODE_GAP = 8;
const TOP_PAD = 54;
const BOTTOM_PAD = 24;
const MIN_NODE = 34; // room for two label lines, prevents label overlap
const MIN_AVAIL = 340;
const X_LEFT = LABEL_W; // 208
const X_RIGHT = W - LABEL_W - BAR_W; // 770
const MID_X = (X_LEFT + BAR_W + X_RIGHT) / 2; // 500
const INCOME_COLORS = ['#22c55e', '#34d399', '#2dd4bf', '#38bdf8', '#60a5fa', '#818cf8', '#4ade80', '#a7f3d0'];
const EXPENSE_COLORS = ['#6c5ce7', '#00d2ff', '#f59e0b', '#a78bfa', '#fb923c', '#facc15', '#f472b6', '#2dd4bf', '#93c5fd', '#c4b5fd'];
const DEFICIT_COLOR = '#ef4444';

function svgEl(tag, attrs = {}, text = null) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    node.setAttribute(k, String(v));
  }
  if (text !== null) node.textContent = text;
  return node;
}

function truncate(value, max) {
  const s = String(value || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export async function render(outlet) {
  const meta = getMeta() || {};
  let group = ['category', 'necessity'].includes(store.get(store.KEYS.ieGroup))
    ? store.get(store.KEYS.ieGroup)
    : 'category';

  outlet.innerHTML = `
    <div class="toolbar">
      <label class="field">
        <span class="field-label">Group Expenditure By</span>
        <select class="select" id="ie-group">
          <option value="category">Category</option>
          <option value="necessity">Necessity Level</option>
        </select>
      </label>
      <div class="grow"></div>
      <div class="stats" id="ie-stats"></div>
    </div>
    <div class="card">
      <div class="flow-scroll" id="ie-scroll"></div>
    </div>`;

  const groupSel = outlet.querySelector('#ie-group');
  const statsEl = outlet.querySelector('#ie-stats');
  const scroll = outlet.querySelector('#ie-scroll');
  groupSel.value = group;

  let destroyed = false;
  let loadSeq = 0;
  let rowsCache = null;

  groupSel.addEventListener('change', () => {
    store.set(store.KEYS.ieGroup, groupSel.value);
    group = groupSel.value;
    draw();
  });

  function emptyState(message) {
    return `<div class="empty-state"><div class="empty-icon"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 4-7"/></svg></div><p>${api.esc(message)}</p></div>`;
  }

  function showError(message) {
    if (!scroll || !scroll.isConnected) return;
    scroll.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg></div><h3>Couldn't load data</h3><p>${api.esc(message)}</p><button type="button" class="btn btn-ghost btn-sm" data-retry>Retry</button></div>`;
    const btn = scroll.querySelector('[data-retry]');
    if (btn) btn.addEventListener('click', load);
  }

  function updateStats(income, expense) {
    const net = income - expense;
    statsEl.innerHTML =
      `<div class="stat"><span class="stat-label">Income</span><span class="stat-value num pos">${charts.formatCurrency(income)}</span></div>` +
      `<div class="stat"><span class="stat-label">Expenditure</span><span class="stat-value num neg">${expense > 0 ? '-' : ''}${charts.formatCurrency(expense)}</span></div>` +
      `<div class="stat"><span class="stat-label">Net</span><span class="stat-value num ${net >= 0 ? 'pos' : 'neg'}">${charts.formatCurrency(net)}</span></div>`;
  }

  function draw() {
    const rows = Array.isArray(rowsCache) ? rowsCache : [];
    const incomeMap = new Map();
    const expenseMap = new Map();
    const field = group === 'necessity' ? 'necessity_level' : 'category';
    const blank = group === 'necessity' ? 'Unassigned' : 'Uncategorized';
    let income = 0;
    let expense = 0;

    for (const row of rows) {
      const amount = Number(row.amount) || 0;
      if (amount > 0) {
        income += amount;
        const key = row.category || 'Uncategorized Income';
        incomeMap.set(key, (incomeMap.get(key) || 0) + amount);
      } else if (amount < 0) {
        expense += -amount;
        const key = row[field] || blank;
        expenseMap.set(key, (expenseMap.get(key) || 0) + -amount);
      }
    }

    const deficit = Math.max(0, expense - income);
    const D = Math.max(income, expense);
    updateStats(income, expense);

    scroll.innerHTML = '';
    if (!rows.length || D <= 0) {
      scroll.innerHTML = emptyState('No income or expenditure in the selected range.');
      return;
    }

    // Left column: deficit first (if any), then income sources by amount.
    const left = [];
    if (deficit > 0) left.push({ name: 'Deficit', amount: deficit, color: DEFICIT_COLOR });
    [...incomeMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, amount], i) => {
        left.push({ name, amount, color: INCOME_COLORS[i % INCOME_COLORS.length] });
      });

    // Right column: expenditure groups by amount.
    const right = [...expenseMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount], i) => ({
        name,
        amount,
        color: EXPENSE_COLORS[i % EXPENSE_COLORS.length],
      }));

    const avail = Math.max(MIN_AVAIL, 46 * Math.max(left.length, right.length));
    const scale = avail / D;
    const heights = (list) => list.map((n) => Math.max(MIN_NODE, n.amount * scale));
    const colH = (hs) => hs.reduce((sum, h) => sum + h, 0) + NODE_GAP * Math.max(0, hs.length - 1);
    const hL = heights(left);
    const hR = heights(right);
    const contentH = Math.max(colH(hL), colH(hR), avail);
    // When the deficit is the sole income-side node it represents the whole
    // outflow; stretch it to the full content height so it spans the column
    // instead of being centered with a gap above and below.
    if (deficit > 0 && left.length === 1) hL[0] = contentH;
    const svgH = contentH + TOP_PAD + BOTTOM_PAD;
    const place = (hs) => {
      const out = [];
      let y = TOP_PAD + (contentH - colH(hs)) / 2;
      for (const h of hs) {
        out.push(y);
        y += h + NODE_GAP;
      }
      return out;
    };
    const yL = place(hL);
    const yR = place(hR);

    const svg = svgEl('svg', {
      class: 'flow-svg',
      viewBox: `0 0 ${W} ${svgH}`,
      preserveAspectRatio: 'xMidYMin meet',
      role: 'img',
      'aria-label': 'Income flowing into expenditure',
    });
    const ribbonLayer = svgEl('g');
    const nodeLayer = svgEl('g');
    svg.appendChild(ribbonLayer);
    svg.appendChild(nodeLayer);

    // Column headers.
    nodeLayer.appendChild(
      svgEl('text', { class: 'flow-col-head', x: X_LEFT, y: 24, 'text-anchor': 'start' }, 'Income')
    );
    nodeLayer.appendChild(
      svgEl(
        'text',
        { class: 'flow-col-head', x: X_RIGHT + BAR_W, y: 24, 'text-anchor': 'end' },
        `Expenditure by ${group === 'necessity' ? 'Necessity Level' : 'Category'}`
      )
    );

    // Ribbons. Cursors advance for every pair; only hairlines are skipped so
    // the column geometry stays aligned with the node heights.
    const lc = yL.slice();
    const rc = yR.slice();
    for (let i = 0; i < left.length; i++) {
      for (let j = 0; j < right.length; j++) {
        const amount = (left[i].amount * right[j].amount) / D;
        const t = amount * scale;
        const y0 = lc[i];
        const y1 = rc[j];
        lc[i] += t;
        rc[j] += t;
        if (t < 0.75) continue;
        const x0 = X_LEFT + BAR_W;
        const x1 = X_RIGHT;
        const path = svgEl('path', {
          class: 'flow-ribbon',
          fill: left[i].color,
          d: `M ${x0} ${y0} C ${MID_X} ${y0} ${MID_X} ${y1} ${x1} ${y1} L ${x1} ${y1 + t} C ${MID_X} ${y1 + t} ${MID_X} ${y0 + t} ${x0} ${y0 + t} Z`,
        });
        path.appendChild(
          svgEl('title', {}, `${left[i].name} → ${right[j].name}: ${charts.formatCurrency(amount)}`)
        );
        ribbonLayer.appendChild(path);
      }
    }

    // Left nodes with labels outside the bar.
    for (let i = 0; i < left.length; i++) {
      const node = left[i];
      const y = yL[i];
      const g = svgEl('g', { class: 'flow-node' });
      const rect = svgEl('rect', {
        x: X_LEFT,
        y,
        width: BAR_W,
        height: Math.max(2, hL[i]),
        rx: 3,
        fill: node.color,
      });
      rect.appendChild(svgEl('title', {}, `${node.name}: ${charts.formatCurrency(node.amount)}`));
      g.appendChild(rect);
      g.appendChild(
        svgEl(
          'text',
          { class: 'flow-node-label', x: X_LEFT - 8, y: y + 13, 'text-anchor': 'end' },
          truncate(node.name, 24)
        )
      );
      g.appendChild(
        svgEl(
          'text',
          { class: 'flow-node-amount', x: X_LEFT - 8, y: y + 27, 'text-anchor': 'end' },
          charts.formatCurrencyShort(node.amount)
        )
      );
      nodeLayer.appendChild(g);
    }

    // Right nodes with labels outside the bar.
    for (let j = 0; j < right.length; j++) {
      const node = right[j];
      const y = yR[j];
      const pct = expense > 0 ? (node.amount / expense) * 100 : 0;
      const g = svgEl('g', { class: 'flow-node' });
      const rect = svgEl('rect', {
        x: X_RIGHT,
        y,
        width: BAR_W,
        height: Math.max(2, hR[j]),
        rx: 3,
        fill: node.color,
      });
      rect.appendChild(svgEl('title', {}, `${node.name}: ${charts.formatCurrency(node.amount)}`));
      g.appendChild(rect);
      g.appendChild(
        svgEl(
          'text',
          { class: 'flow-node-label', x: X_RIGHT + BAR_W + 8, y: y + 13, 'text-anchor': 'start' },
          truncate(node.name, 24)
        )
      );
      g.appendChild(
        svgEl(
          'text',
          { class: 'flow-node-amount', x: X_RIGHT + BAR_W + 8, y: y + 27, 'text-anchor': 'start' },
          `${charts.formatCurrencyShort(node.amount)} · ${pct.toFixed(1)}%`
        )
      );
      nodeLayer.appendChild(g);
    }

    scroll.appendChild(svg);
    if (right.length === 0) {
      const note = document.createElement('p');
      note.className = 'muted';
      note.style.marginTop = '10px';
      note.textContent = 'No expenditure in the selected range.';
      scroll.appendChild(note);
    }
  }

  async function load() {
    const seq = ++loadSeq;
    const start = store.get(store.KEYS.dateStart) || meta.date_min || api.todayISO();
    const end = store.get(store.KEYS.dateEnd) || api.todayISO();
    try {
      const res = await api.getVisualData({ date_start: start, date_end: end });
      if (destroyed || seq !== loadSeq) return;
      if (!scroll.isConnected) return;
      rowsCache = Array.isArray(res && res.rows) ? res.rows : [];
      draw();
    } catch (err) {
      if (destroyed || seq !== loadSeq) return;
      const message = err.message || 'Failed to load data';
      showError(message);
      toast(message, 'error');
    }
  }

  await load();

  return function cleanup() {
    destroyed = true;
  };
}
