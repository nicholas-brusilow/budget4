// Month-over-Month — compare complete months within the selected range.

import * as api from '../api.js';
import * as store from '../store.js';
import * as charts from '../charts.js';
import { getMeta, toast } from '../app.js';

function keyOf(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

/** Months fully contained in [startISO, endISO]. */
function completeMonths(startISO, endISO) {
  const start = api.parseISO(startISO);
  const end = api.parseISO(endISO);
  if (!start || !end) return [];
  const out = [];
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const endFirst = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cur.getTime() <= endFirst.getTime()) {
    const last = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    if (cur.getTime() >= start.getTime() && last.getTime() <= end.getTime()) {
      out.push({
        key: keyOf(cur.getFullYear(), cur.getMonth()),
        label: cur.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        days: last.getDate(),
      });
    }
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return out;
}

function monthKeyOf(dateISO) {
  const d = api.parseISO(dateISO);
  if (!d) return null;
  return keyOf(d.getFullYear(), d.getMonth());
}

export async function render(outlet) {
  const meta = getMeta() || {};
  let perDay = false;
  let destroyed = false;

  outlet.innerHTML = `
    <div class="toolbar">
      <label class="switch" style="padding-bottom:4px">
        <input type="checkbox" id="mom-perday"><span class="track"></span>
        <span>Amount Per Day</span>
      </label>
      <div style="flex:1"></div>
      <div class="total-label" id="mom-total"><span class="total-caption">Total Spending</span>—</div>
    </div>
    <div class="card chart-card">
      <div class="card-head"><div class="card-title"><h2 id="mom-title">Spending by Month</h2></div></div>
      <div class="chart-box tall" id="mom-chart-box"><canvas id="mom-chart"></canvas></div>
    </div>`;

  const perDayInput = outlet.querySelector('#mom-perday');
  const totalEl = outlet.querySelector('#mom-total');
  const titleEl = outlet.querySelector('#mom-title');
  const chartBox = outlet.querySelector('#mom-chart-box');
  const myCharts = [];
  let loadSeq = 0;

  perDayInput.addEventListener('change', () => {
    perDay = perDayInput.checked;
    load();
  });

  function empty(message) {
    charts.destroyCharts(myCharts);
    chartBox.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg></div><h3>No complete months</h3><p>${api.esc(message)}</p></div>`;
  }

  function showError(message) {
    if (!chartBox.isConnected) return;
    chartBox.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg></div><h3>Couldn't load data</h3><p>${api.esc(message)}</p><button type="button" class="btn btn-ghost btn-sm" data-retry>Retry</button></div>`;
    const btn = chartBox.querySelector('[data-retry]');
    if (btn) btn.addEventListener('click', load);
  }

  async function load() {
    const seq = ++loadSeq;
    charts.destroyCharts(myCharts);
    const start = store.get(store.KEYS.dateStart) || (meta.date_min || api.todayISO());
    const end = store.get(store.KEYS.dateEnd) || api.todayISO();
    const months = completeMonths(start, end);

    if (!months.length) {
      totalEl.innerHTML = `<span class="total-caption">${perDay ? 'Avg Daily Spending' : 'Total Spending'}</span>—`;
      empty('The selected range does not fully contain a calendar month.');
      return;
    }

    chartBox.innerHTML = '<canvas></canvas>';
    const canvas = chartBox.querySelector('canvas');

    try {
      const res = await api.getVisualData({
        date_start: start,
        date_end: end,
        category: store.get(store.KEYS.categories) || [],
        necessity: store.get(store.KEYS.necessity) || [],
      });
      if (destroyed || seq !== loadSeq) return;
      if (!chartBox.isConnected) return;
      const rows = Array.isArray(res && res.rows) ? res.rows : [];

      const monthIndexByKey = new Map(months.map((m, i) => [m.key, i]));
      const selectedCats = store.get(store.KEYS.categories) || [];

      const totals = months.map(() => 0);
      // category -> array by month
      const byCat = new Map();
      let totalSpent = 0;

      for (const row of rows) {
        const amount = Number(row.amount) || 0;
        if (amount >= 0) continue;
        const mk = monthKeyOf(row.date);
        if (mk === null || !monthIndexByKey.has(mk)) continue;
        const idx = monthIndexByKey.get(mk);
        const value = Math.abs(amount);
        totalSpent += value;
        totals[idx] += value;
        if (selectedCats.length) {
          const catName = row.category || 'Uncategorized';
          if (!byCat.has(catName)) byCat.set(catName, months.map(() => 0));
          byCat.get(catName)[idx] += value;
        }
      }

      // Scale per day if requested.
      const scaleMonth = (value, idx) => (perDay ? value / months[idx].days : value);
      const scaledTotals = totals.map((v, i) => scaleMonth(v, i));
      const scaledTotal = perDay
        ? totalSpent / months.reduce((n, m) => n + m.days, 0)
        : totalSpent;

      totalEl.innerHTML = `<span class="total-caption">${
        perDay ? 'Avg Daily Spending' : 'Total Spending'
      } (complete months)</span>${charts.formatCurrency(scaledTotal)}`;
      titleEl.textContent = perDay
        ? 'Average Daily Spending by Month'
        : 'Total Spending by Month';

      const labels = months.map((m) => m.label);

      if (!selectedCats.length) {
        myCharts.push(charts.makeBar(canvas, {
          labels,
          values: scaledTotals,
          colors: charts.palette(months.length),
          horizontal: false,
          valueLabels: true,
        }));
      } else {
        const datasets = [];
        let i = 0;
        for (const [catName, values] of byCat.entries()) {
          datasets.push({
            label: catName,
            data: values.map((v, idx) => scaleMonth(v, idx)),
            backgroundColor: charts.paletteColor(i),
          });
          i += 1;
        }
        // Include selected categories with no data so the legend is stable.
        for (const catName of selectedCats) {
          if (!byCat.has(catName)) {
            datasets.push({
              label: catName,
              data: months.map(() => 0),
              backgroundColor: charts.paletteColor(i),
            });
            i += 1;
          }
        }
        myCharts.push(charts.makeBar(canvas, {
          labels,
          datasets,
          horizontal: false,
          valueLabels: false,
        }));
      }
    } catch (err) {
      if (destroyed || seq !== loadSeq) return;
      const message = err.message || 'Failed to load chart data';
      showError(message);
      toast(message, 'error');
    }
  }

  await load();

  return function cleanup() {
    destroyed = true;
    charts.destroyCharts(myCharts);
  };
}
