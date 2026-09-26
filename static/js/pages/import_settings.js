// Import Settings — configure per-account CSV parsing and run imports.

import * as api from '../api.js';
import * as router from '../router.js';
import { getMeta, reloadMeta, toast } from '../app.js';

const SIGNS = [
  { value: 'negative', title: 'Expenses appear as negative amounts', example: '-12.34' },
  { value: 'positive', title: 'Expenses appear as positive amounts', example: '12.34' },
];

function guessColumn(columns, kind) {
  const list = Array.isArray(columns) ? columns : [];
  const patterns = {
    date: /date|posted|trans/i,
    amount: /amount|debit|credit|value|balance/i,
    description: /description|desc|memo|name|details|payee|merchant/i,
  };
  const match = list.find((c) => patterns[kind] && patterns[kind].test(String(c)));
  if (match) return match;
  const fallback = { date: 0, amount: 1, description: 2 }[kind] || 0;
  return list[fallback] || '';
}

function previewTable(preview, columns) {
  let cols = Array.isArray(columns) ? columns : [];
  let rows = [];

  if (Array.isArray(preview) && preview.length) {
    if (Array.isArray(preview[0])) {
      rows = preview.slice(0, 5);
    } else {
      if (!cols.length) cols = Object.keys(preview[0] || {});
      rows = preview.slice(0, 5).map((r) => cols.map((c) => (r ? r[c] : '')));
    }
  } else if (preview && typeof preview === 'object') {
    // Column-oriented preview: { column: [values...] }
    if (!cols.length) cols = Object.keys(preview);
    const arrays = cols.map((c) => (Array.isArray(preview[c]) ? preview[c] : []));
    const len = arrays.reduce((n, a) => Math.max(n, a.length), 0);
    rows = [];
    for (let i = 0; i < Math.min(len, 5); i += 1) {
      rows.push(arrays.map((a) => a[i]));
    }
  }

  if (!rows.length) {
    return '<div class="empty-state compact"><p>No preview rows available.</p></div>';
  }

  return `
    <div class="table-wrap table-scroll-sm">
      <table class="data">
        <thead><tr>${cols.map((c) => `<th>${api.esc(c)}</th>`).join('')}</tr></thead>
        <tbody>
          ${rows
            .map(
              (row) =>
                `<tr>${row
                  .map((cell) => `<td class="td-muted">${api.esc(cell == null ? '' : cell)}</td>`)
                  .join('')}</tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function selectOptions(columns, selected) {
  const list = Array.isArray(columns) ? [...new Set(columns.filter(Boolean))] : [];
  if (selected && !list.includes(selected)) list.unshift(selected);
  return (
    '<option value=""></option>' +
    list
      .map((c) => `<option value="${api.esc(c)}"${c === selected ? ' selected' : ''}>${api.esc(c)}</option>`)
      .join('')
  );
}

/**
 * Build a config form. `columns` may be empty for reconfigure; the
 * current config values are always included as options.
 */
function configFormHtml(account, columns, config = {}) {
  const cols = Array.isArray(columns) && columns.length ? columns : [];
  const dateCol = config.date_column || guessColumn(cols, 'date');
  const amountCol = config.amount_column || guessColumn(cols, 'amount');
  const descCol = config.description_column || guessColumn(cols, 'description');
  const sign = config.expenditure_sign === 'positive' ? 'positive' : 'negative';
  const radioId = `sign-${account}`;
  return `
    <div class="imp-form" data-account="${api.esc(account)}">
      <div class="row" style="gap:14px;align-items:flex-start">
        <label class="field grow">
          <span class="field-label">Date Column</span>
          <select class="select" data-field="date_column">${selectOptions(cols, dateCol)}</select>
        </label>
        <label class="field grow">
          <span class="field-label">Amount Column</span>
          <select class="select" data-field="amount_column">${selectOptions(cols, amountCol)}</select>
        </label>
        <label class="field grow">
          <span class="field-label">Description Column</span>
          <select class="select" data-field="description_column">${selectOptions(cols, descCol)}</select>
        </label>
      </div>
      <div class="field mt-16">
        <span class="field-label">How do expenses appear?</span>
        <div class="radio-group">
          ${SIGNS.map(
            (s) => `
            <label class="radio${s.value === sign ? ' selected' : ''}">
              <input type="radio" name="${api.esc(radioId)}" value="${s.value}" data-field="expenditure_sign"${s.value === sign ? ' checked' : ''}>
              <span>
                <span class="radio-text">${api.esc(s.title)}</span><br>
                <span class="radio-example">e.g. ${api.esc(s.example)}</span>
              </span>
            </label>`
          ).join('')}
        </div>
      </div>
      <div class="btn-row mt-16">
        <button class="btn btn-primary" type="button" data-action="save-config" data-account="${api.esc(account)}">Save &amp; Import</button>
      </div>
    </div>`;
}

function collectForm(form) {
  const get = (f) => {
    const node = form.querySelector(`[data-field="${f}"]`);
    return node ? node.value : '';
  };
  const signNode = form.querySelector('[data-field="expenditure_sign"]:checked');
  return {
    date_column: get('date_column'),
    amount_column: get('amount_column'),
    description_column: get('description_column'),
    expenditure_sign: signNode ? signNode.value : 'negative',
  };
}

function runSummary(run) {
  const added = run && run.added != null ? run.added : 0;
  const total = run && run.total != null ? run.total : 0;
  const warnings = (run && run.accounts ? run.accounts : []).reduce(
    (n, a) => n + (Array.isArray(a.warnings) ? a.warnings.length : 0),
    0
  );
  const skipped = run && Array.isArray(run.skipped) ? run.skipped.length : 0;
  let msg = `Import finished: added ${added} of ${total} rows.`;
  if (warnings) msg += ` ${warnings} warning${warnings === 1 ? '' : 's'}.`;
  if (skipped) msg += ` ${skipped} account${skipped === 1 ? '' : 's'} skipped.`;
  return msg;
}

/** Demo mode short-circuits imports: report that instead of a run summary. */
function showRunToast(run) {
  if (run && run.demo_mode) {
    toast('Demo mode is active — CSV imports are paused.', 'info');
    return;
  }
  toast(runSummary(run), 'success');
}

function demoNoticeHtml() {
  return `
    <div class="notice mb-12">
      <strong>Demo data active</strong>
      <p>
        The database currently holds a generated demo dataset covering
        <span class="mono">Jan–Aug 2026</span>. CSV imports are paused while demo
        mode is active — the raw <span class="mono">rawdata</span> files are left
        untouched. To switch back to your real data, run
        <code>docker compose exec app python -m app.demo live</code>.
      </p>
    </div>`;
}

export async function render(outlet) {
  const meta = getMeta() || {};
  const demoMode = !!(meta && meta.demo_mode);
  let pending = [];
  let configs = {};
  try {
    const [pendingRes, configRes] = await Promise.all([api.getImportPending(), api.getImportConfigs()]);
    pending = api.asList(pendingRes, 'pending', 'items');
    configs = (configRes && configRes.configs) || {};
  } catch (err) {
    toast(err.message || 'Failed to load import settings', 'error');
  }

  const pendingNames = Array.isArray(meta.pending_accounts) ? meta.pending_accounts : [];

  const warningCard =
    pending.length || pendingNames.length
      ? `<div class="card card-warning">
          <div class="card-head" style="margin-bottom:0">
            <div class="card-title">
              <h2>Setup required</h2>
              <span class="hint">${api.esc(
                (pendingNames.length ? pendingNames : pending.map((p) => p.account)).join(', ')
              )} — new data folder(s) detected. Configure how their CSVs are read below.</span>
            </div>
          </div>
        </div>`
      : '';

  const pendingCards = pending.length
    ? pending
        .map((p) => {
          const files = Array.isArray(p.files) ? p.files : [];
          const fileList = files.length
            ? files.slice(0, 4).join(', ') + (files.length > 4 ? ` +${files.length - 4} more` : '')
            : p.sample_file || '—';
          const cols = Array.isArray(p.columns) ? p.columns : [];
          return `
          <div class="card">
            <div class="card-head">
              <div class="card-title">
                <h2>${api.esc(p.account)}</h2>
                <span class="hint">Files: ${api.esc(fileList)}</span>
              </div>
              <span class="badge badge-warning"><span class="dot"></span>Pending</span>
            </div>
            <p class="explainer mb-12">Sample: <span class="mono">${api.esc(p.sample_file || '')}</span></p>
            <div class="field">
              <span class="field-label">Preview (first 5 rows)</span>
              ${previewTable(p.preview, cols)}
            </div>
            <div class="mt-16">${configFormHtml(p.account, cols, {})}</div>
          </div>`;
        })
        .join('')
    : '';

  const configuredAccounts = Object.keys(configs);
  const configuredRows = configuredAccounts.length
    ? configuredAccounts
        .map((account) => {
          const c = configs[account] || {};
          return `<tr>
            <td>${api.esc(account)}</td>
            <td class="mono td-muted">${api.esc(c.date_column || '—')}</td>
            <td class="mono td-muted">${api.esc(c.amount_column || '—')}</td>
            <td class="mono td-muted">${api.esc(c.description_column || '—')}</td>
            <td>${api.esc(c.expenditure_sign || '—')}</td>
            <td class="td-actions"><button class="btn btn-ghost btn-sm" type="button" data-action="reconfigure" data-account="${api.esc(account)}">Reconfigure</button></td>
          </tr>`;
        })
        .join('')
    : '';

  outlet.innerHTML = `
    ${demoMode ? demoNoticeHtml() : ''}
    ${warningCard}
    <div class="card">
      <div class="card-head">
        <div class="card-title">
          <h2>Import Configs</h2>
          <span class="hint">A config applies to every CSV placed in that account's folder from now on. Already-imported rows are untouched.</span>
        </div>
        <button class="btn btn-primary" type="button" id="imp-run"${
          demoMode ? ' disabled title="CSV imports are paused while demo mode is active"' : ''
        }>Run import now</button>
      </div>
      ${
        configuredAccounts.length
          ? `<div class="table-wrap table-scroll-sm">
              <table class="data">
                <thead><tr><th>Account</th><th>Date Column</th><th>Amount Column</th><th>Description Column</th><th>Expense Sign</th><th></th></tr></thead>
                <tbody>${configuredRows}</tbody>
              </table>
            </div>
            <div id="imp-reconfigure" class="mt-16"></div>`
          : `<div class="empty-state compact">
              <p>No accounts configured yet. Configure a pending account above.</p>
            </div>`
      }
    </div>
    ${pendingCards}
    ${
      !pendingCards && !configuredAccounts.length
        ? `<div class="card"><div class="empty-state">
            <div class="empty-icon"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 20h16"/></svg></div>
            <h3>No import data found</h3>
            <p>Place CSV files inside an account folder under rawdata, then return here.</p>
          </div></div>`
        : ''
    }`;

  const reconfigureEl = outlet.querySelector('#imp-reconfigure');

  outlet.addEventListener('change', (e) => {
    const radio = e.target.closest && e.target.closest('.radio input[type="radio"]');
    if (radio && radio.closest('.radio-group')) {
      for (const r of radio.closest('.radio-group').querySelectorAll('.radio')) {
        r.classList.toggle('selected', r.contains(radio));
      }
    }
  });

  outlet.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'reconfigure') {
      const account = btn.dataset.account;
      const config = configs[account] || {};
      const cols = [config.date_column, config.amount_column, config.description_column].filter(Boolean);
      reconfigureEl.innerHTML = `
        <div class="card card-danger" style="margin:0">
          <div class="card-head">
            <div class="card-title">
              <h2>Reconfigure ${api.esc(account)}</h2>
              <span class="hint">Changes apply to future imports only.</span>
            </div>
            <button class="btn btn-ghost btn-sm" type="button" data-action="close-reconfigure">Close</button>
          </div>
          ${configFormHtml(account, cols, config)}
        </div>`;
      reconfigureEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    if (action === 'close-reconfigure') {
      reconfigureEl.innerHTML = '';
      return;
    }

    if (action === 'save-config') {
      const account = btn.dataset.account;
      const form = btn.closest('.imp-form');
      if (!form) return;
      const body = collectForm(form);
      if (!body.date_column || !body.amount_column || !body.description_column) {
        toast('Please choose date, amount and description columns.', 'error');
        return;
      }
      btn.disabled = true;
      try {
        await api.putImportConfig(account, body);
        const run = await api.runImport();
        await reloadMeta();
        showRunToast(run);
        await router.refresh();
      } catch (err) {
        btn.disabled = false;
        toast(err.message || 'Failed to save import config', 'error');
      }
    }
  });

  const runBtn = outlet.querySelector('#imp-run');
  if (runBtn) {
    runBtn.addEventListener('click', async () => {
      runBtn.disabled = true;
      try {
        const run = await api.runImport();
        await reloadMeta();
        showRunToast(run);
        await router.refresh();
      } catch (err) {
        runBtn.disabled = false;
        toast(err.message || 'Import failed', 'error');
      }
    });
  }

  return null;
}
