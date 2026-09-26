// Cumulative Line Plot — cumulative spending over the selected range.

import * as api from '../api.js';
import * as store from '../store.js';
import * as charts from '../charts.js';
import { getMeta, toast } from '../app.js';

export async function render(outlet) {
  const meta = getMeta() || {};
  let destroyed = false;

  outlet.innerHTML = `
    <div class="card-grid">
      <div class="card chart-card">
        <div class="card-head"><div class="card-title"><h2>Cumulative Spending by Category</h2></div></div>
        <div class="chart-box tall" id="cum-cat-box"><canvas id="cum-cat"></canvas></div>
      </div>
      <div class="card chart-card">
        <div class="card-head"><div class="card-title"><h2>Cumulative Spending by Necessity Level</h2></div></div>
        <div class="chart-box tall" id="cum-nec-box"><canvas id="cum-nec"></canvas></div>
      </div>
    </div>`;

  const catBox = outlet.querySelector('#cum-cat-box');
  const necBox = outlet.querySelector('#cum-nec-box');
  const myCharts = [];
  let loadSeq = 0;

  function empty(box, message) {
    if (box) {
      box.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 4-7"/></svg></div><p>${api.esc(message)}</p></div>`;
    }
  }

  function showError(box, message, retry) {
    if (!box || !box.isConnected) return;
    box.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg></div><h3>Couldn't load data</h3><p>${api.esc(message)}</p><button type="button" class="btn btn-ghost btn-sm" data-retry>Retry</button></div>`;
    const btn = box.querySelector('[data-retry]');
    if (btn) btn.addEventListener('click', retry);
  }

  async function load() {
    const seq = ++loadSeq;
    charts.destroyCharts(myCharts);
    catBox.innerHTML = '<canvas></canvas>';
    necBox.innerHTML = '<canvas></canvas>';
    const start = store.get(store.KEYS.dateStart) || (meta.date_min || api.todayISO());
    const end = store.get(store.KEYS.dateEnd) || api.todayISO();
    const numDays = api.rangeDays(start, end);

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

      const labels = [];
      for (let i = 0; i < numDays; i++) labels.push(api.addDaysISO(start, i));

      const series = (keyField, blankLabel) => {
        const map = new Map();
        for (const row of rows) {
          const amount = Number(row.amount) || 0;
          if (amount >= 0) continue;
          const idx = api.dayIndex(start, row.date);
          if (idx < 0 || idx >= numDays) continue;
          const key = row[keyField] || blankLabel;
          if (!map.has(key)) map.set(key, new Array(numDays).fill(0));
          map.get(key)[idx] += Math.abs(amount);
        }
        return map;
      };

      const cumulate = (values) => {
        let running = 0;
        return values.map((v) => {
          running += v;
          return running;
        });
      };

      const catMap = series('category', 'Uncategorized');
      const necMap = series('necessity_level', 'Unassigned');

      const catCanvas = catBox.querySelector('canvas');
      const necCanvas = necBox.querySelector('canvas');

      if (!catMap.size) {
        empty(catBox, 'No spending in the selected range.');
      } else {
        const datasets = [...catMap.entries()].map(([label, values], i) => ({
          label,
          data: cumulate(values),
          borderColor: charts.paletteColor(i),
          backgroundColor: 'transparent',
        }));
        myCharts.push(charts.makeLine(catCanvas, { labels, datasets }));
      }

      if (!necMap.size) {
        empty(necBox, 'No spending in the selected range.');
      } else {
        const datasets = [...necMap.entries()].map(([label, values], i) => ({
          label,
          data: cumulate(values),
          borderColor: charts.paletteColor(i),
          backgroundColor: 'transparent',
        }));
        myCharts.push(charts.makeLine(necCanvas, { labels, datasets }));
      }
    } catch (err) {
      if (destroyed || seq !== loadSeq) return;
      const message = err.message || 'Failed to load chart data';
      showError(catBox, message, load);
      showError(necBox, message, load);
      toast(message, 'error');
    }
  }

  await load();

  return function cleanup() {
    destroyed = true;
    charts.destroyCharts(myCharts);
  };
}
