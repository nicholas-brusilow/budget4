// Create Transaction — manual Cash/Crypto entry form.

import * as api from '../api.js';
import { getMeta, toast } from '../app.js';

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
  const accounts = Array.isArray(meta.accounts) && meta.accounts.length ? meta.accounts : ['Cash'];
  const categories = (meta.categories || []).map((c) => c.name);
  const necessity = (meta.necessity_levels || []).map((n) => n.name);
  const defaultAccount = accounts.includes('Cash') ? 'Cash' : accounts[0];
  const recent = [];

  outlet.innerHTML = `
    <div class="card" style="max-width:720px">
      <div class="card-head">
        <div class="card-title">
          <h2>New Transaction</h2>
          <span class="hint">Amounts follow the convention: negative = money out, positive = money in.</span>
        </div>
      </div>
      <form id="ct-form" class="stack" novalidate>
        <div class="row" style="gap:14px;align-items:flex-start">
          <label class="field grow">
            <span class="field-label">Date</span>
            <input type="date" class="input" id="ct-date" required>
          </label>
          <label class="field grow">
            <span class="field-label">Amount</span>
            <input type="number" step="0.01" class="input" id="ct-amount" placeholder="-12.34" required>
            <span class="hint muted" style="font-size:11.5px">Negative = money out</span>
          </label>
        </div>
        <div class="row" style="gap:14px;align-items:flex-start">
          <label class="field grow">
            <span class="field-label">Account</span>
            <select class="select" id="ct-account">
              ${accounts.map((a) => `<option value="${api.esc(a)}"${a === defaultAccount ? ' selected' : ''}>${api.esc(a)}</option>`).join('')}
            </select>
          </label>
          <label class="field grow">
            <span class="field-label">Description</span>
            <input type="text" class="input" id="ct-description" placeholder="Required" required>
          </label>
        </div>
        <div class="row" style="gap:14px;align-items:flex-start">
          <label class="field grow">
            <span class="field-label">Category</span>
            <select class="select" id="ct-category">
              <option value=""></option>
              ${categories.map((c) => `<option value="${api.esc(c)}">${api.esc(c)}</option>`).join('')}
            </select>
          </label>
          <label class="field grow">
            <span class="field-label">Necessity</span>
            <select class="select" id="ct-necessity">
              <option value=""></option>
              ${necessity.map((n) => `<option value="${api.esc(n)}">${api.esc(n)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="btn-row">
          <button type="submit" class="btn btn-primary" id="ct-submit">Create Transaction</button>
          <button type="reset" class="btn btn-ghost" id="ct-reset">Clear</button>
        </div>
      </form>
    </div>
    <div class="card" style="max-width:720px" id="ct-recent-card">
      <div class="card-head">
        <div class="card-title">
          <h2>Recently Created</h2>
          <span class="hint">Transactions you created in this session.</span>
        </div>
      </div>
      <div id="ct-recent"></div>
    </div>`;

  const form = outlet.querySelector('#ct-form');
  const dateInput = outlet.querySelector('#ct-date');
  const amountInput = outlet.querySelector('#ct-amount');
  const accountInput = outlet.querySelector('#ct-account');
  const descInput = outlet.querySelector('#ct-description');
  const catInput = outlet.querySelector('#ct-category');
  const necInput = outlet.querySelector('#ct-necessity');
  const submitBtn = outlet.querySelector('#ct-submit');
  const recentEl = outlet.querySelector('#ct-recent');

  dateInput.value = api.todayISO();

  function renderRecent() {
    if (!recent.length) {
      recentEl.innerHTML = `
        <div class="empty-state compact">
          <p>No transactions created yet in this session.</p>
        </div>`;
      return;
    }
    recentEl.innerHTML = `
      <div class="table-wrap table-scroll-sm">
        <table class="data">
          <thead><tr><th>Date</th><th>Description</th><th>Account</th><th class="num">Amount</th><th>Category</th></tr></thead>
          <tbody>
            ${recent
              .map((r) => {
                const amt = Number(r.amount) || 0;
                return `<tr>
                  <td class="mono td-muted">${api.esc(r.date || '')}</td>
                  <td class="td-desc">${api.esc(r.description || '')}</td>
                  <td class="td-muted">${api.esc(r.account || '')}</td>
                  <td class="num ${amt < 0 ? 'neg' : 'pos'}">${currency(amt)}</td>
                  <td class="td-muted">${api.esc(r.category || '—')}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>`;
  }

  renderRecent();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const description = descInput.value.trim();
    const amountRaw = amountInput.value.trim();
    const date = dateInput.value;
    if (!description) {
      descInput.classList.add('input-error');
      descInput.focus();
      toast('Description is required.', 'error');
      return;
    }
    descInput.classList.remove('input-error');
    if (!date) {
      toast('Please choose a date.', 'error');
      return;
    }
    if (amountRaw === '' || Number.isNaN(Number(amountRaw))) {
      amountInput.classList.add('input-error');
      amountInput.focus();
      toast('Please enter a valid amount.', 'error');
      return;
    }
    amountInput.classList.remove('input-error');

    const payload = {
      date,
      amount: Number(amountRaw),
      description,
      account: accountInput.value,
    };
    if (catInput.value) payload.category = catInput.value;
    if (necInput.value) payload.necessity_level = necInput.value;

    submitBtn.disabled = true;
    try {
      const created = await api.createTransaction(payload);
      recent.unshift(created || payload);
      if (recent.length > 8) recent.pop();
      renderRecent();
      toast(`Created "${payload.description}" on ${payload.date}.`, 'success');
      amountInput.value = '';
      descInput.value = '';
      catInput.value = '';
      necInput.value = '';
      amountInput.focus();
    } catch (err) {
      toast(err.message || 'Failed to create transaction', 'error');
    } finally {
      submitBtn.disabled = false;
    }
  });

  form.addEventListener('reset', () => {
    setTimeout(() => {
      dateInput.value = api.todayISO();
      descInput.classList.remove('input-error');
      amountInput.classList.remove('input-error');
    }, 0);
  });

  return null;
}
