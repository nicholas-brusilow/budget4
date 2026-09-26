// Categories — manage categories and necessity levels.

import * as api from '../api.js';
import * as store from '../store.js';
import * as router from '../router.js';
import { getMeta, reloadMeta, toast, confirmDialog, promptDialog } from '../app.js';

function normalize(items, metaItems) {
  if (Array.isArray(items) && items.length) return items;
  if (Array.isArray(metaItems) && metaItems.length) return metaItems;
  return Array.isArray(items) ? items : Array.isArray(metaItems) ? metaItems : [];
}

function tableHtml(kind, items) {
  if (!items.length) {
    return `<div class="empty-state compact"><p>No ${kind === 'category' ? 'categories' : 'necessity levels'} yet.</p></div>`;
  }
  return `
    <div class="table-wrap table-scroll-sm">
      <table class="data">
        <thead><tr><th>Name</th><th class="num">Transactions</th><th></th></tr></thead>
        <tbody>
          ${items
            .map((item) => {
              const system = kind === 'category' && item.is_income;
              const id = api.esc(item.id);
              return `<tr>
                <td>${api.esc(item.name)} ${
                system ? '<span class="badge badge-system">System</span>' : ''
              }</td>
                <td class="num td-muted">${api.esc(item.count != null ? item.count : 0)}</td>
                <td class="td-actions">
                  <button class="btn btn-ghost btn-sm" type="button" data-action="rename" data-kind="${kind}" data-id="${id}" data-name="${api.esc(item.name)}">Rename</button>
                  <button class="btn btn-danger btn-sm" type="button" data-action="delete" data-kind="${kind}" data-id="${id}" data-name="${api.esc(item.name)}"${
                system ? ' disabled title="System categories cannot be deleted"' : ''
              }>Delete</button>
                </td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;
}

export async function render(outlet) {
  const meta = getMeta() || {};
  let categories = [];
  let necessity = [];
  try {
    const [catRes, necRes] = await Promise.all([api.getCategories(), api.getNecessityLevels()]);
    categories = normalize(api.asList(catRes, 'categories'), meta.categories);
    necessity = normalize(api.asList(necRes, 'necessity_levels', 'necessities'), meta.necessity_levels);
  } catch (err) {
    categories = normalize([], meta.categories);
    necessity = normalize([], meta.necessity_levels);
    toast(err.message || 'Failed to load categories', 'error');
  }

  outlet.innerHTML = `
    <div class="card-grid">
      <div class="card">
        <div class="card-head">
          <div class="card-title">
            <h2>Categories</h2>
            <span class="hint">Renaming relabels matching transactions. Income categories are system-managed.</span>
          </div>
        </div>
        <div id="cat-table">${tableHtml('category', categories)}</div>
        <form class="row mt-16" id="cat-add" style="align-items:flex-end">
          <label class="field grow">
            <span class="field-label">New Category</span>
            <input type="text" class="input" id="cat-new" placeholder="e.g. groceries">
          </label>
          <button class="btn btn-primary" type="submit">Add</button>
        </form>
      </div>

      <div class="card">
        <div class="card-head">
          <div class="card-title">
            <h2>Necessity Levels</h2>
            <span class="hint">Renaming relabels matching transactions.</span>
          </div>
        </div>
        <div id="nec-table">${tableHtml('necessity', necessity)}</div>
        <form class="row mt-16" id="nec-add" style="align-items:flex-end">
          <label class="field grow">
            <span class="field-label">New Necessity Level</span>
            <input type="text" class="input" id="nec-new" placeholder="e.g. essential">
          </label>
          <button class="btn btn-primary" type="submit">Add</button>
        </form>
      </div>
    </div>`;

  async function afterMutation(message) {
    await reloadMeta();
    toast(message, 'success');
    await router.refresh();
  }

  outlet.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const kind = btn.dataset.kind;
    const id = btn.dataset.id;
    const name = btn.dataset.name;

    if (btn.dataset.action === 'rename') {
      const newName = await promptDialog({
        title: `Rename ${kind === 'category' ? 'category' : 'necessity level'}`,
        label: 'New name',
        value: name,
        confirmLabel: 'Rename',
      });
      if (!newName || newName === name) return;
      try {
        const res =
          kind === 'category'
            ? await api.renameCategory(id, newName)
            : await api.renameNecessityLevel(id, newName);
        // Keep persistent filters in sync.
        const key = kind === 'category' ? store.KEYS.categories : store.KEYS.necessity;
        const current = store.get(key) || [];
        if (current.includes(name)) {
          store.set(key, current.map((c) => (c === name ? newName : c)));
        }
        const updated = res && res.updated_transactions;
        await afterMutation(
          `Renamed "${name}" to "${newName}".${updated != null ? ` ${updated} transaction(s) updated.` : ''}`
        );
      } catch (err) {
        toast(err.message || 'Rename failed', 'error');
      }
      return;
    }

    if (btn.dataset.action === 'delete') {
      const ok = await confirmDialog({
        title: `Delete ${kind === 'category' ? 'category' : 'necessity level'}?`,
        message: `"${name}" will be removed and cleared from matching transactions. This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      try {
        const res =
          kind === 'category' ? await api.deleteCategory(id) : await api.deleteNecessityLevel(id);
        const key = kind === 'category' ? store.KEYS.categories : store.KEYS.necessity;
        const current = store.get(key) || [];
        if (current.includes(name)) store.set(key, current.filter((c) => c !== name));
        const cleared = res && res.cleared_transactions;
        await afterMutation(
          `Deleted "${name}".${cleared != null ? ` ${cleared} transaction(s) cleared.` : ''}`
        );
      } catch (err) {
        toast(err.message || 'Delete failed', 'error');
      }
    }
  });

  outlet.querySelector('#cat-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = outlet.querySelector('#cat-new');
    const name = input.value.trim();
    if (!name) {
      input.classList.add('input-error');
      return;
    }
    input.classList.remove('input-error');
    try {
      await api.createCategory(name);
      await afterMutation(`Added category "${name}".`);
    } catch (err) {
      toast(err.message || 'Failed to add category', 'error');
    }
  });

  outlet.querySelector('#nec-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = outlet.querySelector('#nec-new');
    const name = input.value.trim();
    if (!name) {
      input.classList.add('input-error');
      return;
    }
    input.classList.remove('input-error');
    try {
      await api.createNecessityLevel(name);
      await afterMutation(`Added necessity level "${name}".`);
    } catch (err) {
      toast(err.message || 'Failed to add necessity level', 'error');
    }
  });

  return null;
}
