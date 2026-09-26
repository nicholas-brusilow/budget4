// Pie Charts — spending breakdown by category and necessity level.

import * as api from '../api.js';
import * as store from '../store.js';
import * as charts from '../charts.js';
import { getMeta, toast } from '../app.js';

const SCALES = [
  { value: 'total', label: 'Total', caption: 'Total Spending' },
  { value: 'day', label: 'Per Day', caption: 'Per-Day Spending' },
  { value: 'week', label: 'Per Week', caption: 'Per-Week Spending' },
  { value: 'month', label: 'Per Month', caption: 'Per-Month Spending' },
];

function scaleInfo(value) {
  return SCALES.find((s) => s.value === value) || SCALES[0];
}

export function divisorFor(scale, numDays) {
  if (scale === 'day') return numDays;
  if (scale === 'week') return numDays / 7;
  if (scale === 'month') return numDays / 30.4375;
  return 1;
}

export function groupSpending(rows, keyField, blankLabel) {
  const map = new Map();
  let total = 0;
  for (const row of rows) {
    const amount = Number(row.amount) || 0;
    if (amount >= 0) continue;
    const value = Math.abs(amount);
    total += value;
    const key = row[keyField] || blankLabel;
    map.set(key, (map.get(key) || 0) + value);
  }
  return { map, total };
}

export async function render(outlet) {
  const meta = getMeta() || {};
  let scale = store.get(store.KEYS.pieScale) || 'total';
  if (!['total', 'day', 'week', 'month'].includes(scale)) scale = 'total';

  outlet.innerHTML = `
    <div class="toolbar">
      <label class="field">
        <span class="field-label">Time Scale</span>
        <select class="select" id="pie-scale">
          ${SCALES.map((s) => `<option value="${s.value}"${s.value === scale ? ' selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </label>
      <div style="flex:1"></div>
      <div class="total-label" id="pie-total"><span class="total-caption">Total Spending</span>—</div>
    </div>
    <div class="card-grid">
      <div class="card chart-card">
        <div class="card-head"><div class="card-title"><h2 id="pie-cat-title">Spending by Category</h2></div></div>
        <div class="chart-box"><canvas id="pie-cat"></canvas></div>
      </div>
      <div class="card chart-card">
        <div class="card-head"><div class="card-title"><h2 id="pie-nec-title">Spending by Necessity Level</h2></div></div>
        <div class="chart-box"><canvas id="pie-nec"></canvas></div>
      </div>
    </div>`;

  const scaleSel = outlet.querySelector('#pie-scale');
  const totalEl = outlet.querySelector('#pie-total');
  const catTitle = outlet.querySelector('#pie-cat-title');
  const necTitle = outlet.querySelector('#pie-nec-title');
  const catBox = outlet.querySelector('#pie-cat').parentElement;
  const necBox = outlet.querySelector('#pie-nec').parentElement;
  const myCharts = [];
  let destroyed = false;
  let loadSeq = 0;

  scaleSel.addEventListener('change', () => {
    scale = scaleSel.value;
    store.set(store.KEYS.pieScale, scale);
    load();
  });

  async function load() {
    const seq = ++loadSeq;
    charts.destroyCharts(myCharts);
    // Re-create fresh canvases so a prior empty state can recover.
    catBox.innerHTML = '<canvas></canvas>';
    necBox.innerHTML = '<canvas></canvas>';
    const start = store.get(store.KEYS.dateStart) || (meta.date_min || api.todayISO());
    const end = store.get(store.KEYS.dateEnd) || api.todayISO();
    try {
      const res = await api.getVisualData({
        date_start: start,
        date_end: end,
        category: store.get(store.KEYS.categories) || [],
        necessity: store.get(store.KEYS.necessity) || [],
      });
      if (destroyed || seq !== loadSeq) return;
      if (!catBox.isConnected || !necBox.isConnected) return;
      const rows = Array.isArray(res && res.rows) ? res.rows : [];
      const numDays = api.rangeDays(start, end);
      const divisor = divisorFor(scale, numDays);
      const info = scaleInfo(scale);

      const cat = groupSpending(rows, 'category', 'Uncategorized');
      const nec = groupSpending(rows, 'necessity_level', 'Unassigned');

      totalEl.innerHTML = `<span class="total-caption">${api.esc(info.caption)}</span>${charts.formatCurrency(
        cat.total / divisor
      )}`;
      catTitle.textContent = `Spending by Category — ${info.label}`;
      necTitle.textContent = `Spending by Necessity Level — ${info.label}`;

      const catEntries = [...cat.map.entries()].sort((a, b) => b[1] - a[1]);
      const necEntries = [...nec.map.entries()].sort((a, b) => b[1] - a[1]);

      const catCanvas = catBox.querySelector('canvas');
      const necCanvas = necBox.querySelector('canvas');

      if (!catEntries.length) {
        showEmpty(catBox, 'No spending in the selected range.');
      } else {
        myCharts.push(charts.makeDoughnut(catCanvas, {
          labels: catEntries.map((e) => e[0]),
          values: catEntries.map((e) => e[1] / divisor),
          colors: charts.palette(catEntries.length),
          tooltipTotal: cat.total / divisor,
        }));
      }

      if (!necEntries.length) {
        showEmpty(necBox, 'No spending in the selected range.');
      } else {
        myCharts.push(charts.makeDoughnut(necCanvas, {
          labels: necEntries.map((e) => e[0]),
          values: necEntries.map((e) => e[1] / divisor),
          colors: charts.palette(necEntries.length),
          tooltipTotal: nec.total / divisor,
        }));
      }
    } catch (err) {
      if (destroyed || seq !== loadSeq) return;
      const message = err.message || 'Failed to load chart data';
      showError(catBox, message, load);
      showError(necBox, message, load);
      toast(message, 'error');
    }
  }

  function showEmpty(box, message) {
    if (box) {
      box.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21.2 15.9A10 10 0 118.1 2.8"/><path d="M22 12A10 10 0 0012 2v10z"/></svg></div><p>${api.esc(message)}</p></div>`;
    }
  }

  function showError(box, message, retry) {
    if (!box || !box.isConnected) return;
    box.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg></div><h3>Couldn't load data</h3><p>${api.esc(message)}</p><button type="button" class="btn btn-ghost btn-sm" data-retry>Retry</button></div>`;
    const btn = box.querySelector('[data-retry]');
    if (btn) btn.addEventListener('click', retry);
  }

  await load();

  return function cleanup() {
    destroyed = true;
    charts.destroyCharts(myCharts);
  };
}
