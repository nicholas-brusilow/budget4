// Expenditures — filterable, editable transaction table.

import * as api from '../api.js';
import * as store from '../store.js';
import { getMeta, toast, confirmDialog, setNavGuard, createMultiSelect } from '../app.js';

// Pending edits persist across re-renders (e.g. a global filter change)
// so in-progress work is never silently lost.
const pendingEdits = new Map();

function currency(value) {
  const n = Number(value) || 0;
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function optionsWithCurrent(names, current) {
  const list = Array.isArray(names) ? [...names] : [];
  if (current && !list.includes(current)) list.unshift(current);
  return list;
}

export async function render(outlet) {
  const meta = getMeta() || {};
  let page = 1;
  let search = '';
  let pageSize = Number(store.get(store.KEYS.pageSize)) || 50;
  let data = { items: [], total: 0, page: 1, page_size: pageSize, pages: 1 };
  let destroyed = false;
  let loadingSeq = 0;

  const catNames = (meta.categories || []).map((c) => c.name);
  const necNames = (meta.necessity_levels || []).map((n) => n.name);

  outlet.innerHTML = `
    <div class="toolbar">
      <label class="field grow">
        <span class="field-label">Search</span>
        <input type="search" class="input" id="tx-search" placeholder="Description, account, category…" />
      </label>
      <div class="field" id="tx-account-wrap"></div>
      <label class="field">
        <span class="field-label">Page Size</span>
        <select class="select" id="tx-pagesize">
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="250">250</option>
        </select>
      </label>
      <div class="switches">
        <label class="switch"><input type="checkbox" id="tx-hide-ignored"><span class="track"></span><span>Hide ignored</span></label>
        <label class="switch"><input type="checkbox" id="tx-uncat"><span class="track"></span><span>Show only uncategorized</span></label>
      </div>
    </div>
    <div class="card">
      <div class="card-head">
        <div class="card-title">
          <h2>Transactions</h2>
          <span class="hint" id="tx-summary"></span>
        </div>
        <div id="tx-badges" class="row"></div>
      </div>
      <div class="table-wrap" id="tx-table-wrap"></div>
      <div class="pager" id="tx-pager" hidden>
        <span class="pager-info" id="tx-page-info"></span>
        <div class="pager-controls">
          <button class="btn btn-ghost btn-sm" id="tx-prev" type="button">Previous</button>
          <span class="pager-page" id="tx-page-label"></span>
          <button class="btn btn-ghost btn-sm" id="tx-next" type="button">Next</button>
        </div>
      </div>
      <div class="save-bar hidden" id="tx-save-bar">
        <span class="save-info" id="tx-save-info"></span>
        <div class="row">
          <button class="btn btn-ghost" id="tx-discard" type="button">Discard</button>
          <button class="btn btn-primary" id="tx-save" type="button" disabled>Save Changes (0)</button>
        </div>
      </div>
    </div>`;

  const searchInput = outlet.querySelector('#tx-search');
  const pageSizeSel = outlet.querySelector('#tx-pagesize');
  const hideIgnored = outlet.querySelector('#tx-hide-ignored');
  const uncat = outlet.querySelector('#tx-uncat');
  const tableWrap = outlet.querySelector('#tx-table-wrap');
  const pager = outlet.querySelector('#tx-pager');
  const pageInfo = outlet.querySelector('#tx-page-info');
  const pageLabel = outlet.querySelector('#tx-page-label');
  const prevBtn = outlet.querySelector('#tx-prev');
  const nextBtn = outlet.querySelector('#tx-next');
  const saveBar = outlet.querySelector('#tx-save-bar');
  const saveInfo = outlet.querySelector('#tx-save-info');
  const saveBtn = outlet.querySelector('#tx-save');
  const discardBtn = outlet.querySelector('#tx-discard');
  const summaryEl = outlet.querySelector('#tx-summary');
  const badgesEl = outlet.querySelector('#tx-badges');

  pageSizeSel.value = String(pageSize);
  hideIgnored.checked = !!store.get(store.KEYS.hideIgnored);
  uncat.checked = false;

  // Account multi-select (persisted).
  const accountWrap = outlet.querySelector('#tx-account-wrap');
  accountWrap.appendChild(
    createMultiSelect({
      label: 'Account',
      options: meta.accounts || [],
      selected: store.get(store.KEYS.accounts) || [],
      placeholder: 'All accounts',
      onChange(selected) {
        store.set(store.KEYS.accounts, selected);
        page = 1;
        load();
      },
    })
  );

  function globalParams() {
    return {
      date_start: store.get(store.KEYS.dateStart) || undefined,
      date_end: store.get(store.KEYS.dateEnd) || undefined,
      category: store.get(store.KEYS.categories) || [],
      necessity: store.get(store.KEYS.necessity) || [],
      account: store.get(store.KEYS.accounts) || [],
    };
  }

  function selectedOptions(names, current) {
    return (
      `<option value=""></option>` +
      optionsWithCurrent(names, current)
        .map((n) => `<option value="${api.esc(n)}"${n === current ? ' selected' : ''}>${api.esc(n)}</option>`)
        .join('')
    );
  }

  function rowHtml(item) {
    const amount = Number(item.amount) || 0;
    const income = !!item.is_income || amount > 0;
    const cls = amount < 0 ? 'neg' : 'pos';
    const timescale = item.timescale || item.date || '';
    const timescaleEnd = item.timescale_end || timescale;
    const desc = api.esc(item.description || '');
    const incomeBadge = income ? '<span class="badge badge-income"><span class="dot"></span>Income</span>' : '';
    const ignoredBadge = item.ignore ? '<span class="badge badge-ignored">Ignored</span>' : '';
    return `
      <tr data-id="${api.esc(item.id)}">
        <td class="mono td-muted">${api.esc(item.date || '')}</td>
        <td class="td-desc" title="${desc}"><div class="desc-wrap"><span class="desc-text">${desc || '<span class="td-muted">—</span>'}</span>${incomeBadge}${ignoredBadge}</div></td>
        <td class="td-muted">${api.esc(item.account || '')}</td>
        <td class="num ${cls}">${currency(amount)}</td>
        <td><select class="select" data-field="category" data-id="${api.esc(item.id)}">${selectedOptions(catNames, item.category || '')}</select></td>
        <td><select class="select" data-field="necessity_level" data-id="${api.esc(item.id)}">${selectedOptions(necNames, item.necessity_level || '')}</select></td>
        <td><input type="date" class="input" data-field="timescale" data-id="${api.esc(item.id)}" value="${api.esc(timescale)}"></td>
        <td><input type="date" class="input" data-field="timescale_end" data-id="${api.esc(item.id)}" value="${api.esc(timescaleEnd)}"></td>
        <td><input type="checkbox" data-field="ignore" data-id="${api.esc(item.id)}" ${item.ignore ? 'checked' : ''}></td>
      </tr>`;
  }

  function applyPending(items) {
    for (const item of items) {
      const p = pendingEdits.get(item.id);
      if (p) Object.assign(item, p);
    }
  }

  function renderTable() {
    const items = data.items || [];
    applyPending(items);

    if (!items.length) {
      tableWrap.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z"/><path d="M9 9h6M9 13h4"/></svg></div>
          <h3>No transactions found</h3>
          <p>Try widening the date range or clearing filters.</p>
        </div>`;
      return;
    }

    tableWrap.innerHTML = `
      <table class="data data-tx">
        <thead>
          <tr>
            <th>Date</th><th>Description</th><th>Account</th><th class="num">Amount</th>
            <th>Category</th><th>Necessity</th><th>Timescale</th><th>Timescale End</th><th>Ignored</th>
          </tr>
        </thead>
        <tbody>${items.map(rowHtml).join('')}</tbody>
      </table>`;

    for (const tr of tableWrap.querySelectorAll('tbody tr')) {
      if (pendingEdits.has(tr.dataset.id)) tr.classList.add('row-dirty');
    }
  }

  function updateSaveBar() {
    const count = pendingEdits.size;
    saveBar.classList.toggle('hidden', count === 0);
    saveBtn.disabled = count === 0;
    saveBtn.textContent = `Save Changes (${count})`;
    const fields = [...pendingEdits.values()].reduce((n, p) => n + Object.keys(p).length, 0);
    saveInfo.textContent = count
      ? `${count} transaction${count === 1 ? '' : 's'} with unsaved changes (${fields} field${fields === 1 ? '' : 's'}).`
      : '';
  }

  function renderMeta() {
    const total = Number(data.total) || 0;
    const size = Number(data.page_size) || pageSize;
    const p = Number(data.page) || 1;
    const from = total === 0 ? 0 : (p - 1) * size + 1;
    const to = Math.min(total, (p - 1) * size + size);
    summaryEl.textContent = `Showing ${from}–${to} of ${total}`;
    const uncatCount = Number(meta.uncategorized_count) || 0;
    badgesEl.innerHTML =
      `<span class="badge${uncatCount ? ' badge-warning' : ''}">${api.esc(uncatCount)} uncategorized</span>` +
      `<span class="badge">${api.esc(meta.transaction_count || 0)} total</span>`;

    const pages = Number(data.pages) || 1;
    pager.hidden = pages <= 1;
    pageInfo.textContent = `Page ${p} of ${pages}`;
    pageLabel.textContent = `${p} / ${pages}`;
    prevBtn.disabled = p <= 1;
    nextBtn.disabled = p >= pages;
  }

  async function load() {
    const seq = ++loadingSeq;
    try {
      const params = Object.assign(globalParams(), {
        hide_ignored: !!store.get(store.KEYS.hideIgnored),
        uncategorized_only: uncat.checked,
        search: search || undefined,
        page: page,
        page_size: pageSize,
        sort: 'date',
        order: 'desc',
      });
      const res = await api.getTransactions(params);
      if (destroyed || seq !== loadingSeq) return;
      data = {
        items: res.items || [],
        total: res.total || 0,
        page: res.page || 1,
        page_size: res.page_size || pageSize,
        pages: res.pages || 1,
      };
      page = data.page;
      renderTable();
      renderMeta();
      updateSaveBar();
    } catch (err) {
      if (destroyed || seq !== loadingSeq) return;
      toast(err.message || 'Failed to load transactions', 'error');
    }
  }

  // --- events -----------------------------------------------------

  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      search = searchInput.value.trim();
      page = 1;
      load();
    }, 300);
  });

  pageSizeSel.addEventListener('change', () => {
    pageSize = Number(pageSizeSel.value) || 50;
    store.set(store.KEYS.pageSize, pageSize);
    page = 1;
    load();
  });

  hideIgnored.addEventListener('change', () => {
    store.set(store.KEYS.hideIgnored, hideIgnored.checked);
    page = 1;
    load();
  });

  uncat.addEventListener('change', () => {
    page = 1;
    load();
  });

  tableWrap.addEventListener('change', (e) => {
    const target = e.target;
    const field = target.dataset ? target.dataset.field : null;
    if (!field || !target.dataset.id) return;
    const id = target.dataset.id;
    const item = (data.items || []).find((it) => String(it.id) === String(id));
    if (!item) return;
    let value;
    if (field === 'ignore') value = target.checked;
    else value = target.value;

    const orig =
      field === 'ignore'
        ? !!item.ignore
        : field === 'timescale' || field === 'timescale_end'
        ? item[field] || item.date || ''
        : item[field] || '';

    let p = pendingEdits.get(id) || {};
    if (String(value) === String(orig)) delete p[field];
    else p[field] = value;
    if (Object.keys(p).length) pendingEdits.set(id, p);
    else pendingEdits.delete(id);

    const tr = target.closest('tr');
    if (tr) tr.classList.toggle('row-dirty', pendingEdits.has(id));
    updateSaveBar();
  });

  prevBtn.addEventListener('click', () => {
    if (page > 1) {
      page -= 1;
      load();
    }
  });

  nextBtn.addEventListener('click', () => {
    const pages = Number(data.pages) || 1;
    if (page < pages) {
      page += 1;
      load();
    }
  });

  discardBtn.addEventListener('click', async () => {
    pendingEdits.clear();
    updateSaveBar();
    await load();
  });

  saveBtn.addEventListener('click', async () => {
    const updates = [...pendingEdits.entries()].map(([id, changes]) => {
      const out = { id };
      for (const [k, v] of Object.entries(changes)) out[k] = v;
      return out;
    });
    if (!updates.length) return;
    saveBtn.disabled = true;
    try {
      const res = await api.patchTransactions(updates);
      toast(`Saved ${res && res.updated != null ? res.updated : updates.length} change(s).`, 'success');
      pendingEdits.clear();
      updateSaveBar();
      await load();
    } catch (err) {
      saveBtn.disabled = false;
      toast(err.message || 'Failed to save changes', 'error');
    }
  });

  setNavGuard(async () => {
    if (pendingEdits.size === 0) return true;
    const ok = await confirmDialog({
      title: 'Discard unsaved changes?',
      message: `You have unsaved edits on ${pendingEdits.size} transaction${
        pendingEdits.size === 1 ? '' : 's'
      }. Leaving this page will discard them.`,
      confirmLabel: 'Discard & leave',
      danger: true,
    });
    if (ok) pendingEdits.clear();
    return ok;
  });

  updateSaveBar();
  await load();

  return function cleanup() {
    destroyed = true;
    setNavGuard(null);
    clearTimeout(searchTimer);
  };
}
