// Automatic Categorization — regex rules + review proposals.

import * as api from '../api.js';
import { getMeta, toast, confirmDialog } from '../app.js';

function currency(value) {
  const n = Number(value) || 0;
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export async function render(outlet) {
  const meta = getMeta() || {};
  const categories = (meta.categories || []).map((c) => c.name);
  const necessity = (meta.necessity_levels || []).map((n) => n.name);

  let rules = [];
  let review = { pending_count: 0, proposals: [], multi_match: [], no_match_count: 0 };

  outlet.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div class="card-title">
          <h2>Rules</h2>
          <span class="hint">Case-insensitive regexes applied to new transactions. Nothing is saved until approved.</span>
        </div>
      </div>
      <div id="rules-table"><div class="empty-state compact"><p>Loading rules…</p></div></div>
      <form class="row mt-16" id="rule-add" style="align-items:flex-end">
        <label class="field grow">
          <span class="field-label">Regex</span>
          <input type="text" class="input" id="rule-regex" placeholder="e.g. (?i)whole foods">
        </label>
        <label class="field">
          <span class="field-label">Category</span>
          <select class="select" id="rule-category">
            <option value=""></option>
            ${categories.map((c) => `<option value="${api.esc(c)}">${api.esc(c)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span class="field-label">Necessity</span>
          <select class="select" id="rule-necessity">
            <option value=""></option>
            ${necessity.map((n) => `<option value="${api.esc(n)}">${api.esc(n)}</option>`).join('')}
          </select>
        </label>
        <button class="btn btn-primary" type="submit">Add Rule</button>
      </form>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">
          <h2>Review New Transactions</h2>
          <span class="hint" id="review-caption">Scanning…</span>
        </div>
        <button class="btn btn-primary" type="button" id="approve-all" style="display:none">Approve All</button>
      </div>
      <div id="review-body"></div>
    </div>`;

  const rulesTable = outlet.querySelector('#rules-table');
  const reviewBody = outlet.querySelector('#review-body');
  const reviewCaption = outlet.querySelector('#review-caption');
  const approveAll = outlet.querySelector('#approve-all');
  let busy = false;

  function renderRules() {
    if (!rules.length) {
      rulesTable.innerHTML = `<div class="empty-state compact">
        <p>No rules yet. Add one below to start proposing categories.</p>
      </div>`;
      return;
    }
    rulesTable.innerHTML = `
      <div class="table-wrap table-scroll-sm">
        <table class="data">
          <thead><tr><th>Regex</th><th>Category</th><th>Necessity</th><th></th></tr></thead>
          <tbody>
            ${rules
              .map(
                (r) => `<tr>
                  <td><span class="regex">${api.esc(r.regex || '')}</span></td>
                  <td class="td-muted">${api.esc(r.category || '—')}</td>
                  <td class="td-muted">${api.esc(r.necessity_level || '—')}</td>
                  <td class="td-actions"><button class="btn btn-danger btn-sm" type="button" data-action="delete-rule" data-id="${api.esc(r.id)}" data-regex="${api.esc(r.regex || '')}">Delete</button></td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderReview() {
    const proposals = Array.isArray(review.proposals) ? review.proposals : [];
    const multi = Array.isArray(review.multi_match) ? review.multi_match : [];
    const pending = Number(review.pending_count) || 0;

    reviewCaption.textContent = `${pending} new transaction${pending === 1 ? '' : 's'} — ${proposals.length} match exactly one rule`;
    approveAll.style.display = proposals.length ? '' : 'none';

    if (!pending && !proposals.length && !multi.length) {
      reviewBody.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
          <h3>Nothing to review</h3>
          <p>Every new transaction has been matched or already reviewed.</p>
        </div>`;
      return;
    }

    const proposalRows = proposals.length
      ? `<div class="table-wrap">
          <table class="data">
            <thead><tr><th>Date</th><th class="num">Amount</th><th>Description</th><th>Account</th><th>Category</th><th>Necessity</th><th></th></tr></thead>
            <tbody>
              ${proposals
                .map((p) => {
                  const amt = Number(p.amount) || 0;
                  const key = api.esc(p.dedup_key);
                  return `<tr>
                    <td class="mono td-muted">${api.esc(p.date || '')}</td>
                    <td class="num ${amt < 0 ? 'neg' : 'pos'}">${currency(amt)}</td>
                    <td class="td-desc" title="${api.esc(p.description || '')}">${api.esc(p.description || '')}</td>
                    <td class="td-muted">${api.esc(p.account || '')}</td>
                    <td>${api.esc(p.category || '—')}</td>
                    <td class="td-muted">${api.esc(p.necessity_level || '—')}</td>
                    <td class="td-actions"><button class="btn btn-ghost btn-sm" type="button" data-action="deny" data-key="${key}">Deny</button></td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>`
      : `<div class="empty-state compact"><p>No transactions matched exactly one rule.</p></div>`;

    const multiBlock = multi.length
      ? `<details class="expander mt-16">
          <summary>${multi.length} conflict${multi.length === 1 ? '' : 's'} (multiple rules matched)</summary>
          <div class="expander-body">
            <p class="explainer mb-12">These transactions matched more than one rule, so they were left uncategorized. Adjust the rules above; saving changes re-checks them.</p>
            <div class="table-wrap table-scroll-sm">
              <table class="data">
                <thead><tr><th>Date</th><th class="num">Amount</th><th>Description</th><th>Matched regexes</th></tr></thead>
                <tbody>
                  ${multi
                    .map((m) => {
                      const amt = Number(m.amount) || 0;
                      const regexes = (m.matched_regexes || [])
                        .map((r) => `<span class="regex">${api.esc(r)}</span>`)
                        .join(' ');
                      return `<tr>
                        <td class="mono td-muted">${api.esc(m.date || '')}</td>
                        <td class="num ${amt < 0 ? 'neg' : 'pos'}">${currency(amt)}</td>
                        <td class="td-desc">${api.esc(m.description || '')}</td>
                        <td>${regexes || '—'}</td>
                      </tr>`;
                    })
                    .join('')}
                </tbody>
              </table>
            </div>
          </div>
        </details>`
      : '';

    reviewBody.innerHTML = proposalRows + multiBlock;
  }

  async function rescan(showError = true) {
    if (busy) return;
    busy = true;
    try {
      review = await api.reviewRules();
      renderReview();
    } catch (err) {
      if (showError) toast(err.message || 'Failed to scan transactions', 'error');
      reviewCaption.textContent = 'Scan failed';
    } finally {
      busy = false;
    }
  }

  async function loadRules() {
    try {
      const res = await api.getRules();
      rules = api.asList(res, 'rules');
      renderRules();
    } catch (err) {
      rulesTable.innerHTML = `<div class="empty-state compact"><p>Failed to load rules.</p></div>`;
      toast(err.message || 'Failed to load rules', 'error');
    }
  }

  approveAll.addEventListener('click', async () => {
    const keys = (review.proposals || []).map((p) => p.dedup_key).filter((k) => k != null);
    if (!keys.length) return;
    approveAll.disabled = true;
    try {
      const res = await api.approveRules(keys);
      toast(
        `Approved ${res && res.applied != null ? res.applied : keys.length} proposal(s)${
          res && res.skipped ? `, ${res.skipped} skipped` : ''
        }.`,
        'success'
      );
      await rescan(false);
    } catch (err) {
      toast(err.message || 'Failed to approve proposals', 'error');
    } finally {
      approveAll.disabled = false;
    }
  });

  outlet.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    if (btn.dataset.action === 'deny') {
      const key = btn.dataset.key;
      btn.disabled = true;
      try {
        await api.denyRules([key]);
        toast('Denied proposal.', 'success');
        await rescan(false);
      } catch (err) {
        btn.disabled = false;
        toast(err.message || 'Failed to deny proposal', 'error');
      }
      return;
    }

    if (btn.dataset.action === 'delete-rule') {
      const ok = await confirmDialog({
        title: 'Delete rule?',
        message: `Delete the rule "${btn.dataset.regex}"?`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.deleteRule(btn.dataset.id);
        toast('Rule deleted.', 'success');
        await loadRules();
      } catch (err) {
        toast(err.message || 'Failed to delete rule', 'error');
      }
    }
  });

  outlet.querySelector('#rule-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const regexInput = outlet.querySelector('#rule-regex');
    const regex = regexInput.value.trim();
    if (!regex) {
      regexInput.classList.add('input-error');
      return;
    }
    regexInput.classList.remove('input-error');
    const payload = { regex };
    const cat = outlet.querySelector('#rule-category').value;
    const nec = outlet.querySelector('#rule-necessity').value;
    if (cat) payload.category = cat;
    if (nec) payload.necessity_level = nec;
    try {
      await api.createRule(payload);
      regexInput.value = '';
      outlet.querySelector('#rule-category').value = '';
      outlet.querySelector('#rule-necessity').value = '';
      toast('Rule added.', 'success');
      await loadRules();
      await rescan(false);
    } catch (err) {
      toast(err.message || 'Failed to add rule', 'error');
    }
  });

  await loadRules();
  await rescan();

  return null;
}
