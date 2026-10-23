// Application shell: boot, shared meta, navigation, global filter bar,
// toasts and modals.

import * as api from './api.js';
import * as store from './store.js';
import * as router from './router.js';
import * as charts from './charts.js';

import * as expenditures from './pages/expenditures.js';
import * as createTransaction from './pages/create_transaction.js';
import * as importSettings from './pages/import_settings.js';
import * as categories from './pages/categories.js';
import * as autoCategorization from './pages/auto_categorization.js';
import * as pieCharts from './pages/pie_charts.js';
import * as barCharts from './pages/bar_charts.js';
import * as monthOverMonth from './pages/month_over_month.js';
import * as cumulativeLinePlot from './pages/cumulative_line_plot.js';
import * as incomeExpenditure from './pages/income_expenditure.js';

/* ------------------------------------------------------------------ */
/* Shared meta                                                         */
/* ------------------------------------------------------------------ */

/** Latest /api/meta payload. Read via getMeta(). */
export let meta = null;

let shellReady = false;
let navGuard = null;

export function getMeta() {
  return meta;
}

/** Show the sidebar "Demo data" badge and label the demo/live toggle. */
function updateDemoControls() {
  const badge = document.getElementById('demo-badge');
  if (badge) badge.hidden = !(meta && meta.demo_mode);
  const btn = document.getElementById('demo-toggle');
  if (btn) {
    const demo = !!(meta && meta.demo_mode);
    btn.textContent = demo ? 'Restore Live Data' : 'Load Demo Data';
    btn.title = demo
      ? 'Switch back to the imported rawdata; the demo dataset is kept'
      : 'Switch to the deterministic demo dataset; imported data is kept';
  }
}

/**
 * Re-fetch /api/meta. Returns the fresh payload and (once the shell is
 * ready) rebuilds the global filter options.
 */
export async function reloadMeta({ refreshFilters = true } = {}) {
  meta = await api.getMeta();
  updateDemoControls();
  if (refreshFilters && shellReady) rebuildFilterOptions();
  return meta;
}

export function setNavGuard(fn) {
  navGuard = fn;
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

const ICONS = {
  expenditures:
    '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  create: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  import:
    '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 20h16"/>',
  categories:
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  auto: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><circle cx="4" cy="12" r="2"/><circle cx="12" cy="10" r="2"/><circle cx="20" cy="14" r="2"/>',
  pie: '<path d="M21.2 15.9A10 10 0 118.1 2.8"/><path d="M22 12A10 10 0 0012 2v10z"/>',
  bar: '<path d="M3 21h18"/><rect x="5" y="11" width="3.5" height="8" rx="1"/><rect x="10.5" y="6" width="3.5" height="13" rx="1"/><rect x="16" y="14" width="3.5" height="5" rx="1"/>',
  mom: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>',
  cumulative: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 4-7"/>',
  flow: '<circle cx="5" cy="6" r="2.2"/><circle cx="5" cy="18" r="2.2"/><circle cx="19" cy="12" r="2.2"/><path d="M7 6.8C12 7 14 9 16.8 11M7 17.2C12 17 14 15 16.8 13"/>',
};

function icon(name) {
  return `<span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg></span>`;
}

const NAV_ITEMS = [
  { path: '/expenditures', label: 'Expenditures', title: 'Expenditures', subtitle: 'Browse, filter and edit every transaction', icon: 'expenditures', render: expenditures.render, filters: true },
  { path: '/create', label: 'Create Transaction', title: 'Create Transaction', subtitle: 'Manually add a Cash or Crypto entry', icon: 'create', render: createTransaction.render },
  { path: '/import', label: 'Import Settings', title: 'Import Settings', subtitle: 'Configure how account folders are parsed', icon: 'import', render: importSettings.render },
  { path: '/categories', label: 'Categories', title: 'Categories', subtitle: 'Manage categories and necessity levels', icon: 'categories', render: categories.render },
  { path: '/auto', label: 'Automatic Categorization', title: 'Automatic Categorization', subtitle: 'Regex rules and proposed categorizations', icon: 'auto', render: autoCategorization.render },
  { path: '/pie', label: 'Pie Charts', title: 'Pie Charts', subtitle: 'Spending breakdown by category and necessity', icon: 'pie', render: pieCharts.render, filters: true },
  { path: '/bar', label: 'Bar Charts', title: 'Bar Charts', subtitle: 'Spending ranked by category and necessity', icon: 'bar', render: barCharts.render, filters: true },
  { path: '/mom', label: 'Month-over-Month', title: 'Month-over-Month', subtitle: 'Compare complete months in the selected range', icon: 'mom', render: monthOverMonth.render, filters: true },
  { path: '/cumulative', label: 'Cumulative Line Plot', title: 'Cumulative Line Plot', subtitle: 'Cumulative spending over the selected range', icon: 'cumulative', render: cumulativeLinePlot.render, filters: true },
  { path: '/income-expenditure', label: 'Income Expenditure View', title: 'Income Expenditure View', subtitle: 'Income streams flowing into expenditure', icon: 'flow', render: incomeExpenditure.render, filters: true, hideCategoryFilter: true, hideNecessityFilter: true },
];

/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
/* ------------------------------------------------------------------ */

function el(id) {
  return document.getElementById(id);
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

const TOAST_ICONS = {
  success: '<path d="M20 6L9 17l-5-5"/>',
  error: '<path d="M18 6L6 18M6 6l12 12"/>',
  warning: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
};

/**
 * Show an auto-dismissing toast.
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} [type]
 */
export function toast(message, type = 'info') {
  const stack = el('toast-stack');
  if (!stack) return;
  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  node.innerHTML =
    `<span class="toast-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${TOAST_ICONS[type] || TOAST_ICONS.info}</svg></span>` +
    `<span class="toast-msg"></span>` +
    `<button class="toast-close" type="button" aria-label="Dismiss">&times;</button>`;
  node.querySelector('.toast-msg').textContent = String(message == null ? '' : message);
  stack.appendChild(node);
  const remove = () => {
    node.classList.add('toast-out');
    setTimeout(() => node.remove(), 200);
  };
  node.querySelector('.toast-close').addEventListener('click', remove);
  const ttl = type === 'error' ? 6500 : 4000;
  setTimeout(remove, ttl);
}

/* ------------------------------------------------------------------ */
/* Modal primitives                                                    */
/* ------------------------------------------------------------------ */

function openModal(innerHtml, { onOpen } = {}) {
  const root = el('modal-root');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${innerHtml}</div>`;
  root.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('modal-visible'));
  if (onOpen) onOpen(overlay);
  return { overlay, close: () => closeModal(overlay) };
}

function closeModal(overlay) {
  overlay.classList.remove('modal-visible');
  setTimeout(() => overlay.remove(), 150);
}

/**
 * Styled confirm dialog. Resolves true when confirmed, false otherwise.
 */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const { overlay, close } = openModal(
      `<div class="modal-head"><h3>${api.esc(title || 'Are you sure?')}</h3></div>
       <div class="modal-body"><p>${api.esc(message || '')}</p></div>
       <div class="modal-foot">
         <button class="btn btn-ghost" data-act="cancel">${api.esc(cancelLabel)}</button>
         <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${api.esc(confirmLabel)}</button>
       </div>`,
      {
        onOpen(root) {
          const ok = root.querySelector('[data-act="ok"]');
          const cancel = root.querySelector('[data-act="cancel"]');
          ok.focus();
          ok.addEventListener('click', () => { close(); resolve(true); });
          cancel.addEventListener('click', () => { close(); resolve(false); });
          root.addEventListener('click', (e) => { if (e.target === root) { close(); resolve(false); } });
          root._onKey = (e) => {
            if (e.key === 'Escape') { close(); resolve(false); }
            if (e.key === 'Enter') { close(); resolve(true); }
          };
          document.addEventListener('keydown', root._onKey);
        },
      }
    );
    const obs = new MutationObserver(() => {
      if (!document.body.contains(overlay)) {
        document.removeEventListener('keydown', overlay._onKey);
        obs.disconnect();
      }
    });
    obs.observe(el('modal-root'), { childList: true });
  });
}

/**
 * Styled text prompt. Resolves the trimmed string, or null on cancel.
 */
export function promptDialog({ title, label = 'Name', value = '', confirmLabel = 'Save', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    const { overlay, close } = openModal(
      `<div class="modal-head"><h3>${api.esc(title || 'Enter a value')}</h3></div>
       <div class="modal-body">
         <label class="field block"><span class="field-label">${api.esc(label)}</span>
         <input type="text" class="input" data-act="input" value="${api.esc(value)}" placeholder="${api.esc(placeholder)}"></label>
       </div>
       <div class="modal-foot">
         <button class="btn btn-ghost" data-act="cancel">Cancel</button>
         <button class="btn btn-primary" data-act="ok">${api.esc(confirmLabel)}</button>
       </div>`,
      {
        onOpen(root) {
          const input = root.querySelector('[data-act="input"]');
          const ok = root.querySelector('[data-act="ok"]');
          const cancel = root.querySelector('[data-act="cancel"]');
          input.focus();
          input.select();
          const submit = () => {
            const v = input.value.trim();
            if (!v) { input.classList.add('input-error'); input.focus(); return; }
            close(); resolve(v);
          };
          ok.addEventListener('click', submit);
          cancel.addEventListener('click', () => { close(); resolve(null); });
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
          root.addEventListener('click', (e) => { if (e.target === root) { close(); resolve(null); } });
          root._onKey = (e) => { if (e.key === 'Escape') { close(); resolve(null); } };
          document.addEventListener('keydown', root._onKey);
        },
      }
    );
    const obs = new MutationObserver(() => {
      if (!document.body.contains(overlay)) {
        document.removeEventListener('keydown', overlay._onKey);
        obs.disconnect();
      }
    });
    obs.observe(el('modal-root'), { childList: true });
  });
}

/* ------------------------------------------------------------------ */
/* Reusable multi-select popover                                       */
/* ------------------------------------------------------------------ */

/**
 * Create a multi-select popover.
 * @param {{label?:string, options:(string|{value:string,label:string})[],
 *          selected?:string[], placeholder?:string,
 *          onChange?:(selected:string[])=>void}} cfg
 */
export function createMultiSelect(cfg = {}) {
  const { label = '', options = [], placeholder = 'All', onChange } = cfg;
  const norm = options.map((o) =>
    typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label }
  );
  const selected = new Set((cfg.selected || []).map(String));

  const wrap = document.createElement('div');
  wrap.className = 'multiselect';

  if (label) {
    const lab = document.createElement('span');
    lab.className = 'field-label';
    lab.textContent = label;
    wrap.appendChild(lab);
  }

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'ms-trigger';
  wrap.appendChild(trigger);

  const popover = document.createElement('div');
  popover.className = 'ms-popover';
  wrap.appendChild(popover);

  function renderTrigger() {
    const count = selected.size;
    let text;
    if (count === 0) text = placeholder;
    else if (count === 1) text = [...selected][0];
    else text = `${count} selected`;
    trigger.classList.toggle('ms-active', count > 0);
    trigger.innerHTML = `<span class="ms-text">${api.esc(text)}</span>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
  }

  function renderPopover() {
    popover.innerHTML = '';
    if (!norm.length) {
      const empty = document.createElement('div');
      empty.className = 'ms-empty';
      empty.textContent = 'No options';
      popover.appendChild(empty);
      return;
    }
    const list = document.createElement('div');
    list.className = 'ms-list';
    for (const opt of norm) {
      const item = document.createElement('label');
      item.className = 'ms-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.has(opt.value);
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(opt.value);
        else selected.delete(opt.value);
        renderTrigger();
        if (onChange) onChange([...selected]);
      });
      const span = document.createElement('span');
      span.textContent = opt.label;
      item.appendChild(cb);
      item.appendChild(span);
      list.appendChild(item);
    }
    popover.appendChild(list);
    const foot = document.createElement('div');
    foot.className = 'ms-foot';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn btn-ghost btn-sm';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => {
      selected.clear();
      renderTrigger();
      renderPopover();
      if (onChange) onChange([]);
    });
    foot.appendChild(clear);
    popover.appendChild(foot);
  }

  function onDocClick(e) {
    if (!wrap.contains(e.target)) close();
  }
  function close() {
    popover.classList.remove('open');
    document.removeEventListener('mousedown', onDocClick);
  }
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = popover.classList.toggle('open');
    if (isOpen) document.addEventListener('mousedown', onDocClick);
    else document.removeEventListener('mousedown', onDocClick);
  });

  renderTrigger();
  renderPopover();

  wrap.getSelected = () => [...selected];
  return wrap;
}

/* ------------------------------------------------------------------ */
/* Global filter bar                                                   */
/* ------------------------------------------------------------------ */

function rebuildFilterOptions() {
  const start = el('filter-start');
  const end = el('filter-end');
  if (!start || !end) return;

  const minDate = (meta && meta.date_min) || api.todayISO();
  if (!store.get(store.KEYS.dateStart)) store.set(store.KEYS.dateStart, minDate);
  if (!store.get(store.KEYS.dateEnd)) store.set(store.KEYS.dateEnd, api.todayISO());
  start.value = store.get(store.KEYS.dateStart) || minDate;
  end.value = store.get(store.KEYS.dateEnd) || api.todayISO();
  if (meta && meta.date_min) start.min = meta.date_min;
  if (meta && meta.date_max) end.max = meta.date_max;

  const catWrap = el('filter-cat-wrap');
  const necWrap = el('filter-nec-wrap');

  const catOptions = (meta && meta.categories ? meta.categories : []).map((c) => c.name);
  const necOptions = (meta && meta.necessity_levels ? meta.necessity_levels : []).map((n) => n.name);

  catWrap.innerHTML = '';
  catWrap.appendChild(
    createMultiSelect({
      label: 'Category',
      options: catOptions,
      selected: store.get(store.KEYS.categories) || [],
      placeholder: 'All categories',
      onChange(selected) {
        store.set(store.KEYS.categories, selected);
        router.refresh();
      },
    })
  );

  necWrap.innerHTML = '';
  necWrap.appendChild(
    createMultiSelect({
      label: 'Necessity',
      options: necOptions,
      selected: store.get(store.KEYS.necessity) || [],
      placeholder: 'All levels',
      onChange(selected) {
        store.set(store.KEYS.necessity, selected);
        router.refresh();
      },
    })
  );
}

function wireFilterBar() {
  const start = el('filter-start');
  const end = el('filter-end');
  const reset = el('filter-reset');

  start.addEventListener('change', () => {
    store.set(store.KEYS.dateStart, start.value || null);
    router.refresh();
  });
  end.addEventListener('change', () => {
    store.set(store.KEYS.dateEnd, end.value || null);
    router.refresh();
  });
  reset.addEventListener('click', () => {
    const minDate = (meta && meta.date_min) || api.todayISO();
    store.set(store.KEYS.dateStart, minDate);
    store.set(store.KEYS.dateEnd, api.todayISO());
    store.set(store.KEYS.categories, []);
    store.set(store.KEYS.necessity, []);
    rebuildFilterOptions();
    router.refresh();
  });
}

/* ------------------------------------------------------------------ */
/* Demo / live data-source toggle                                      */
/* ------------------------------------------------------------------ */

/** Point the global date filters at the freshly loaded dataset's bounds. */
function resetFiltersForMeta() {
  const today = api.todayISO();
  const minDate = (meta && meta.date_min) || today;
  const maxDate = (meta && meta.date_max) || today;
  store.set(store.KEYS.dateStart, minDate);
  store.set(store.KEYS.dateEnd, maxDate < today ? maxDate : today);
  store.set(store.KEYS.categories, []);
  store.set(store.KEYS.necessity, []);
}

async function onDemoToggle() {
  const demo = !!(meta && meta.demo_mode);
  const ok = await confirmDialog({
    title: demo ? 'Restore live data?' : 'Load demo data?',
    message: demo
      ? 'Switch back to the imported rawdata (new CSV files are picked up automatically). The demo dataset and its categorizations are kept.'
      : 'Switch to the deterministic demo dataset. Your imported transactions and their categorizations are kept.',
    confirmLabel: demo ? 'Restore Live Data' : 'Load Demo Data',
    danger: !demo,
  });
  if (!ok) return;
  const btn = el('demo-toggle');
  if (btn) {
    btn.disabled = true;
    btn.textContent = demo ? 'Restoring\u2026' : 'Loading\u2026';
  }
  try {
    const res = demo ? await api.restoreLiveData() : await api.loadDemoData();
    await reloadMeta({ refreshFilters: false });
    resetFiltersForMeta();
    rebuildFilterOptions();
    buildNav();
    toast((res && res.message) || (demo ? 'Live data restored.' : 'Demo data loaded.'), 'success');
    router.refresh();
  } catch (err) {
    toast((err && err.message) || 'Failed to switch data source', 'error');
    try {
      await reloadMeta();
    } catch {
      /* keep the last known meta */
    }
  } finally {
    if (btn) btn.disabled = false;
    updateDemoControls();
  }
}

function wireDemoToggle() {
  const btn = el('demo-toggle');
  if (!btn || btn.dataset.wired === '1') return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', onDemoToggle);
}

/* ------------------------------------------------------------------ */
/* Shell + routing                                                     */
/* ------------------------------------------------------------------ */

function buildNav() {
  const nav = el('nav');
  nav.innerHTML = '';
  // Reflect the current route when the nav is (re)built. This keeps the
  // active item correct even if buildNav runs after a route has rendered
  // (e.g. the shell module can be evaluated twice when the entry URL and
  // the page imports resolve to different module URLs).
  const hashPath = String(window.location.hash || '').replace(/^#/, '');
  const activePath = hashPath && !hashPath.startsWith('/') ? `/${hashPath}` : hashPath;
  for (const item of NAV_ITEMS) {
    const a = document.createElement('a');
    a.className = 'nav-item';
    a.href = `#${item.path}`;
    a.dataset.path = item.path;
    if (item.path === activePath) a.classList.add('active');
    a.innerHTML = `${icon(item.icon)}<span class="nav-label">${api.esc(item.label)}</span>`;
    nav.appendChild(a);
  }
  if (meta && Array.isArray(meta.pending_accounts) && meta.pending_accounts.length) {
    const warn = document.createElement('div');
    warn.className = 'nav-warning';
    warn.innerHTML =
      '<span class="dot"></span><span>New data folder detected — configure it in Import Settings.</span>';
    nav.appendChild(warn);
  }
}

function handleRoute(def, path) {
  document.title = `${def.title} · Budget4`;
  const titleEl = el('page-title');
  const subEl = el('page-subtitle');
  if (titleEl) titleEl.textContent = def.title;
  if (subEl) subEl.textContent = def.subtitle || '';

  const filterBar = el('filter-bar');
  if (filterBar) filterBar.hidden = !def.filters;

  // Unconditionally (re)assign the sub-filter visibility so navigating away
  // from a page that hides them restores them on the next page.
  const catWrap = el('filter-cat-wrap');
  const necWrap = el('filter-nec-wrap');
  if (catWrap) catWrap.hidden = !!def.hideCategoryFilter;
  if (necWrap) necWrap.hidden = !!def.hideNecessityFilter;

  for (const a of document.querySelectorAll('.nav-item')) {
    a.classList.toggle('active', a.dataset.path === path);
  }
  const outlet = el('outlet');
  if (outlet) {
    outlet.classList.remove('page-enter');
    // re-trigger the fade-in animation
    void outlet.offsetWidth;
    outlet.classList.add('page-enter');
  }
}

function registerRoutes() {
  for (const item of NAV_ITEMS) {
    router.register(item.path, {
      title: item.title,
      subtitle: item.subtitle,
      filters: !!item.filters,
      hideCategoryFilter: !!item.hideCategoryFilter,
      hideNecessityFilter: !!item.hideNecessityFilter,
      render: item.render,
    });
  }
}

function renderFatal(err) {
  const filterBar = el('filter-bar');
  if (filterBar) filterBar.hidden = true;
  const titleEl = el('page-title');
  const subEl = el('page-subtitle');
  if (titleEl) titleEl.textContent = 'Connection error';
  if (subEl) subEl.textContent = '';
  const outlet = el('outlet');
  outlet.innerHTML = `
    <div class="card">
      <div class="empty-state">
        <div class="empty-icon"><svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg></div>
        <h3>Could not reach the API</h3>
        <p>${api.esc(err && err.message ? err.message : 'Unknown error')}</p>
        <button class="btn btn-primary" id="retry-boot">Retry</button>
      </div>
    </div>`;
  const retry = el('retry-boot');
  if (retry) retry.addEventListener('click', () => boot());
}

async function boot() {
  try {
    const fresh = await api.getMeta();
    meta = fresh;
  } catch (err) {
    renderFatal(err);
    return;
  }
  updateDemoControls();
  if (!shellReady) {
    buildNav();
    registerRoutes();
    router.init({
      outlet: el('outlet'),
      defaultRoute: '/expenditures',
      onRouteChange: handleRoute,
    });
    router.setGuard(async (from, to) => {
      if (navGuard) return await navGuard(from, to);
      return true;
    });
    wireFilterBar();
    wireDemoToggle();
    shellReady = true;
  } else {
    buildNav();
  }
  rebuildFilterOptions();
  router.start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
