// API client + small shared utilities.
// All requests go to the FastAPI JSON API under /api.

const API_BASE = '/api';

/* ------------------------------------------------------------------ */
/* Query building                                                      */
/* ------------------------------------------------------------------ */

/**
 * Build a query string. Array values become repeated params. `null`,
 * `undefined` and `''` values are omitted. Booleans are stringified.
 */
export function buildQuery(params) {
  if (!params) return '';
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v === null || v === undefined || v === '') continue;
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.join('&');
}

/** Turn an error payload into a readable single-line string. */
function errorMessage(data, status) {
  const detail = data && data.detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        if (typeof d === 'string') return d;
        if (d && typeof d === 'object') return d.msg || JSON.stringify(d);
        return String(d);
      })
      .join(', ');
  }
  if (typeof detail === 'string' && detail) return detail;
  if (detail) return JSON.stringify(detail);
  if (typeof data === 'string' && data) return data;
  return `Request failed (HTTP ${status})`;
}

/**
 * Core request helper. Throws an Error with `.status` and `.data` on
 * non-2xx responses. Returns parsed JSON (or raw text when not JSON).
 */
export async function request(path, { method = 'GET', body, params } = {}) {
  let url = API_BASE + path;
  const qs = buildQuery(params);
  if (qs) url += `?${qs}`;
  const opts = { method, headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    const e = new Error('Network error — is the server running?');
    e.cause = err;
    throw e;
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const e = new Error(errorMessage(data, res.status));
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Endpoint wrappers                                                   */
/* ------------------------------------------------------------------ */

export const getMeta = () => request('/meta');

export const loadDemoData = () => request('/demo/load', { method: 'POST' });
export const restoreLiveData = () => request('/demo/live', { method: 'POST' });

export const getTransactions = (params) => request('/transactions', { params });
export const patchTransactions = (updates) =>
  request('/transactions', { method: 'PATCH', body: { updates } });
export const createTransaction = (payload) =>
  request('/transactions', { method: 'POST', body: payload });

export const getImportConfigs = () => request('/import/configs');
export const getImportPending = () => request('/import/pending');
export const putImportConfig = (account, payload) =>
  request(`/import/configs/${encodeURIComponent(account)}`, { method: 'PUT', body: payload });
export const runImport = () => request('/import/run', { method: 'POST' });

export const getCategories = () => request('/categories');
export const createCategory = (name) => request('/categories', { method: 'POST', body: { name } });
export const renameCategory = (id, newName) =>
  request(`/categories/${encodeURIComponent(id)}`, { method: 'PATCH', body: { new_name: newName } });
export const deleteCategory = (id) =>
  request(`/categories/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const getNecessityLevels = () => request('/necessity-levels');
export const createNecessityLevel = (name) =>
  request('/necessity-levels', { method: 'POST', body: { name } });
export const renameNecessityLevel = (id, newName) =>
  request(`/necessity-levels/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { new_name: newName },
  });
export const deleteNecessityLevel = (id) =>
  request(`/necessity-levels/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const getRules = () => request('/rules');
export const createRule = (payload) => request('/rules', { method: 'POST', body: payload });
export const deleteRule = (id) => request(`/rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const reviewRules = () => request('/rules/review', { method: 'POST' });
export const approveRules = (keys) =>
  request('/rules/review/approve', { method: 'POST', body: { keys } });
export const denyRules = (keys) =>
  request('/rules/review/deny', { method: 'POST', body: { keys } });

export const getVisualData = (params) => request('/visual/data', { params });

/* ------------------------------------------------------------------ */
/* Response normalization                                              */
/* ------------------------------------------------------------------ */

/** Pull an array out of common response shapes. */
export function asList(data, ...keys) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const k of keys) {
      if (Array.isArray(data[k])) return data[k];
    }
    for (const k of Object.keys(data)) {
      if (Array.isArray(data[k])) return data[k];
    }
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Dates — always parsed from string components (no UTC off-by-one)    */
/* ------------------------------------------------------------------ */

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Format a local Date as YYYY-MM-DD. */
export function toISO(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Today's local date as YYYY-MM-DD. */
export function todayISO() {
  return toISO(new Date());
}

/**
 * Parse a YYYY-MM-DD string into a *local* Date. Never use
 * `new Date('YYYY-MM-DD')` — that is UTC and can shift the day.
 */
export function parseISO(value) {
  if (!value) return null;
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Human display for a YYYY-MM-DD string. */
export function fmtDate(value) {
  const d = parseISO(value);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Add n days to a YYYY-MM-DD string, returning a YYYY-MM-DD string. */
export function addDaysISO(value, n) {
  const d = parseISO(value);
  if (!d) return value;
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Inclusive day count between two YYYY-MM-DD strings. */
export function rangeDays(startISO, endISO) {
  const a = parseISO(startISO);
  const b = parseISO(endISO);
  if (!a || !b) return 1;
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
}

/** Day index of `dateISO` relative to `startISO` (can be negative). */
export function dayIndex(startISO, dateISO) {
  const a = parseISO(startISO);
  const b = parseISO(dateISO);
  if (!a || !b) return -1;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** Number of days in a given month (monthIndex is 0-based). */
export function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/* ------------------------------------------------------------------ */
/* Misc formatting helpers                                             */
/* ------------------------------------------------------------------ */

/** Escape a value for safe interpolation into innerHTML. */
export function esc(value) {
  return String(value === null || value === undefined ? '' : value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/** Debounce a function. */
export function debounce(fn, wait = 300) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}
