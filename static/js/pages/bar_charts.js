// Bar Charts — spending ranked by category and necessity level.

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

function divisorFor(scale, numDays) {
  if (scale === 'day') return numDays;
  if (scale === 'week') return numDays / 7;
  if (scale === 'month') return numDays / 30.4375;
  return 1;
}

function scaleInfo(value) {
  return SCALES.find((s) => s.value === value) || SCALES[0];
}

function groupSpending(rows, keyField, blankLabel) {
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

function empty(box, message) {
  if (box) {
    box.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 21h18"/><rect x="5" y="11" width="3.5" height="8" rx="1"/><rect x="10.5" y="6" width="3.5" height="13" rx="1"/><rect x="16" y="14" width="3.5" height="5" rx="1"/></svg></div><p>${api.esc(message)}</p></div>`;
  }
}

export async function render(outlet) {
  const meta = getMeta() || {};
  let scale = store.get(store.KEYS.barScale) || 'total';
  if (!['total', 'day', 'week', 'month'].includes(scale)) scale = 'total';

  outlet.innerHTML = `
    <div class="toolbar">
      <label class="field">
        <span class="field-label">Time Scale</span>
        <select class="select" id="bar-scale">
          ${SCALES.map((s) => `<option value="${s.value}"${s.value === scale ? ' selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </label>
      <div style="flex:1"></div>
      <div class="total-label" id="bar-total"><span class="total-caption">Total Spending</span>—</div>
    </div>
    <div class="card-grid">
      <div class="card chart-card">
        <div class="card-head"><div class="card-title"><h2 id="bar-cat-title">Spending by Category</h2></div></div>
        <div class="chart-box tall"><canvas id="bar-cat"></canvas></div>
      </div>
      <div class="card chart-card">
        <div class="card-head"><div class="card-title"><h2 id="bar-nec-title">Spending by Necessity Level</h2></div></div>
        <div class="chart-box tall"><canvas id="bar-nec"></canvas></div>
      </div>
    </div>`;

  const scaleSel = outlet.querySelector('#bar-scale');
  const totalEl = outlet.querySelector('#bar-total');
  const catTitle = outlet.querySelector('#bar-cat-title');
  const necTitle = outlet.querySelector('#bar-nec-title');
  const catBox = outlet.querySelector('#bar-cat').parentElement;
  const necBox = outlet.querySelector('#bar-nec').parentElement;
  const myCharts = [];
  let destroyed = false;
  let loadSeq = 0;

  scaleSel.addEventListener('change', () => {
    scale = scaleSel.value;
    store.set(store.KEYS.barScale, scale);
    load();
  });

  async function load() {
    const seq = ++loadSeq;
    charts.destroyCharts(myCharts);
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
        empty(catBox, 'No spending in the selected range.');
      } else {
        myCharts.push(charts.makeBar(catCanvas, {
          labels: catEntries.map((e) => e[0]),
          values: catEntries.map((e) => e[1] / divisor),
          colors: charts.palette(catEntries.length),
          horizontal: true,
        }));
      }

      if (!necEntries.length) {
        empty(necBox, 'No spending in the selected range.');
      } else {
        myCharts.push(charts.makeBar(necCanvas, {
          labels: necEntries.map((e) => e[0]),
          values: necEntries.map((e) => e[1] / divisor),
          colors: charts.palette(necEntries.length),
          horizontal: true,
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
