// Chart.js integration for the dark theme.
// Exposes formatting helpers, a deterministic palette and thin chart
// factories. Created charts are tracked in a registry so a page can destroy
// exactly the charts it owns via destroyCharts(list) on unmount.

const instances = new Set();

const FONT_STACK =
  'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** `$1,234.56` (negative sign preserved). */
export function formatCurrency(value) {
  const n = Number(value) || 0;
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Currency without cents, e.g. `$1,234`. */
export function formatCurrencyShort(value) {
  const n = Number(value) || 0;
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

const BASE_PALETTE = [
  '#6c5ce7', '#00d2ff', '#22c55e', '#f59e0b', '#ef4444',
  '#a78bfa', '#34d399', '#fb7185', '#38bdf8', '#facc15',
  '#f472b6', '#2dd4bf', '#818cf8', '#fb923c', '#4ade80',
];

/** Deterministic, distinct colour for series index i. */
export function paletteColor(i) {
  const n = Number(i) || 0;
  if (n < BASE_PALETTE.length) return BASE_PALETTE[n];
  const hue = (n * 137.508) % 360;
  return `hsl(${hue.toFixed(1)}, 62%, 60%)`;
}

/** Array of colors for `count` series. */
export function palette(count) {
  return Array.from({ length: count }, (_, i) => paletteColor(i));
}

/* ------------------------------------------------------------------ */
/* Availability + defaults                                             */
/* ------------------------------------------------------------------ */

export function chartsAvailable() {
  return typeof window !== 'undefined' && !!window.Chart;
}

let defaultsApplied = false;

export function initChartDefaults() {
  if (!chartsAvailable() || defaultsApplied) return;
  const Chart = window.Chart;
  Chart.defaults.color = '#8b93a9';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
  Chart.defaults.font.family = FONT_STACK;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.responsive = true;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
  Chart.defaults.plugins.legend.labels.padding = 14;
  Chart.defaults.plugins.legend.position = 'right';
  Chart.defaults.plugins.tooltip.backgroundColor = '#171b28';
  Chart.defaults.plugins.tooltip.borderColor = '#232a3d';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.titleColor = '#e8ecf5';
  Chart.defaults.plugins.tooltip.bodyColor = '#e8ecf5';
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.displayColors = true;
  Chart.defaults.animation = { duration: 350 };
  defaultsApplied = true;
}

/** Replace a canvas with a graceful unavailable message. */
function showUnavailable(canvas) {
  const parent = canvas && canvas.parentElement;
  if (parent) {
    parent.innerHTML =
      '<div class="empty-state"><div class="empty-icon">' +
      '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6">' +
      '<path d="M3 3v18h18"/><path d="M7 14l3-4 3 3 4-6"/></svg>' +
      '</div><p>Charts are unavailable because the Chart.js bundle failed to load.</p></div>';
  }
  return null;
}

function register(chart) {
  instances.add(chart);
  // Defensive: a chart created on a zero-sized box (page just shown) can
  // measure incorrectly. Nudge a resize on the next frame.
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      try {
        chart.resize();
      } catch {
        /* ignore */
      }
    });
  }
  return chart;
}

/* ------------------------------------------------------------------ */
/* Chart factories                                                     */
/* ------------------------------------------------------------------ */

/**
 * Doughnut chart.
 * @param {HTMLCanvasElement} canvas
 * @param {{labels:string[], values:number[], colors?:string[], title?:string,
 *          tooltipTotal?:number, cutout?:string}} cfg
 */
export function makeDoughnut(canvas, cfg) {
  if (!chartsAvailable()) return showUnavailable(canvas);
  initChartDefaults();
  const Chart = window.Chart;
  const values = cfg.values || [];
  const total = cfg.tooltipTotal != null ? cfg.tooltipTotal : values.reduce((a, b) => a + b, 0);
  const colors = cfg.colors && cfg.colors.length ? cfg.colors : palette(values.length);
  const chart = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: cfg.labels || [],
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderColor: '#0a0c12',
          borderWidth: 2,
          hoverOffset: 6,
        },
      ],
    },
    options: {
      cutout: cfg.cutout || '60%',
      plugins: {
        legend: { position: 'right' },
        tooltip: {
          callbacks: {
            title(items) {
              const item = items && items[0];
              return item ? item.label : '';
            },
            label(ctx) {
              return `Amount: ${formatCurrency(Number(ctx.raw) || 0)}`;
            },
            afterLabel(ctx) {
              const value = Number(ctx.raw) || 0;
              const pct = total > 0 ? (value / total) * 100 : 0;
              return `Share: ${pct.toFixed(1)}%`;
            },
            footer() {
              return `Total: ${formatCurrency(total)}`;
            },
          },
        },
      },
    },
  });
  return register(chart);
}

// Plugin that draws the numeric value at the end of each bar.
const valueLabelPlugin = {
  id: 'b4ValueLabel',
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx } = chart;
    const show = opts && opts.show !== false;
    if (!show) return;
    const formatter = (opts && opts.formatter) || formatCurrencyShort;
    ctx.save();
    ctx.font = `600 11px ${FONT_STACK}`;
    ctx.fillStyle = '#e8ecf5';
    ctx.textBaseline = 'middle';
    chart.data.datasets.forEach((dataset, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;
      meta.data.forEach((el, i) => {
        const value = dataset.data[i];
        if (value === null || value === undefined) return;
        const isHorizontal = chart.options.indexAxis === 'y';
        const text = formatter(value);
        const area = chart.chartArea;
        if (isHorizontal) {
          ctx.textAlign = 'left';
          let x = el.x + 8;
          if (area) {
            const w = ctx.measureText(text).width;
            x = Math.min(x, area.right - w);
          }
          ctx.fillText(text, x, el.y);
        } else {
          ctx.textAlign = 'center';
          let x = el.x;
          if (area) {
            const w = ctx.measureText(text).width;
            x = Math.min(Math.max(x, area.left + w / 2), area.right - w / 2);
          }
          ctx.fillText(text, x, el.y - 8);
        }
      });
    });
    ctx.restore();
  },
};

/**
 * Bar chart. Horizontal by default.
 * @param {HTMLCanvasElement} canvas
 * @param {{labels:string[], values?:number[], datasets?:object[],
 *          colors?:string[], horizontal?:boolean, valueLabels?:boolean,
 *          valueFormatter?:Function, stacked?:boolean}} cfg
 */
export function makeBar(canvas, cfg) {
  if (!chartsAvailable()) return showUnavailable(canvas);
  initChartDefaults();
  const Chart = window.Chart;
  const horizontal = cfg.horizontal !== false;
  const colors = cfg.colors && cfg.colors.length ? cfg.colors : palette((cfg.labels || []).length);
  const datasets =
    cfg.datasets && cfg.datasets.length
      ? cfg.datasets.map((ds, i) => ({
          borderRadius: 5,
          maxBarThickness: 34,
          backgroundColor: ds.backgroundColor || paletteColor(i),
          ...ds,
        }))
      : [
          {
            label: cfg.datasetLabel || 'Amount',
            data: cfg.values || [],
            backgroundColor: colors,
            borderRadius: 5,
            maxBarThickness: 34,
          },
        ];
  const multi = datasets.length > 1;
  // The value axis is x for horizontal bars and y for vertical bars. Only it
  // gets the currency tick formatter; the category axis must show its labels
  // (e.g. month names) rather than currency-formatted indices.
  const valueAxis = horizontal ? 'x' : 'y';
  const categoryAxis = horizontal ? 'y' : 'x';
  const categoryScale = {
    stacked: !!cfg.stacked,
    grid: { color: 'rgba(255,255,255,0.06)' },
  };
  const valueScale = {
    stacked: !!cfg.stacked,
    beginAtZero: true,
    grid: { color: 'rgba(255,255,255,0.06)' },
    ticks: {
      callback(value) {
        return formatCurrencyShort(value);
      },
    },
  };
  const chart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels: cfg.labels || [], datasets },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      scales: {
        [categoryAxis]: categoryScale,
        [valueAxis]: valueScale,
      },
      plugins: {
        legend: { display: multi, position: 'top' },
        tooltip: {
          callbacks: {
            label(ctx) {
              const label = ctx.dataset.label ? `${ctx.dataset.label}: ` : '';
              return ` ${label}${formatCurrency(Number(ctx.raw) || 0)}`;
            },
          },
        },
        b4ValueLabel: {
          show: cfg.valueLabels !== false && !multi,
          formatter: cfg.valueFormatter || formatCurrencyShort,
        },
      },
    },
    plugins: [valueLabelPlugin],
  });
  return register(chart);
}

/**
 * Line chart.
 * @param {HTMLCanvasElement} canvas
 * @param {{labels:string[], datasets:object[], yFormatter?:Function}} cfg
 */
export function makeLine(canvas, cfg) {
  if (!chartsAvailable()) return showUnavailable(canvas);
  initChartDefaults();
  const Chart = window.Chart;
  const datasets = (cfg.datasets || []).map((ds, i) => ({
    borderColor: ds.borderColor || paletteColor(i),
    backgroundColor: ds.backgroundColor || 'transparent',
    borderWidth: 2,
    tension: 0.25,
    pointRadius: 0,
    pointHoverRadius: 4,
    fill: false,
    ...ds,
  }));
  const chart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels: cfg.labels || [], datasets },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' } },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: {
            callback(value) {
              return formatCurrencyShort(value);
            },
          },
        },
      },
      plugins: {
        legend: { position: 'right' },
        tooltip: {
          callbacks: {
            label(ctx) {
              return ` ${ctx.dataset.label}: ${formatCurrency(Number(ctx.parsed.y) || 0)}`;
            },
          },
        },
      },
    },
  });
  return register(chart);
}

/**
 * Destroy every chart in the given array and drop it from the registry.
 * Tolerant of null entries (e.g. returned when Chart.js is unavailable).
 */
export function destroyCharts(list) {
  if (!Array.isArray(list)) return;
  for (const chart of list) {
    if (!chart) continue;
    try {
      chart.destroy();
    } catch {
      /* ignore */
    }
    instances.delete(chart);
  }
  list.length = 0;
}
