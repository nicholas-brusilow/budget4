// localStorage-backed persistent UI filters with a tiny pub/sub.
// Every value is JSON-encoded. Subscribers are notified with the key
// that changed; any filter change should trigger a page re-render.

const PREFIX = 'b4.';

export const KEYS = {
  dateStart: 'b4.dateStart',
  dateEnd: 'b4.dateEnd',
  categories: 'b4.categories',
  necessity: 'b4.necessity',
  accounts: 'b4.accounts',
  hideIgnored: 'b4.hideIgnored',
  pageSize: 'b4.pageSize',
  pieScale: 'b4.pieScale',
  barScale: 'b4.barScale',
  ieGroup: 'b4.ieGroup',
};

const DEFAULTS = {
  [KEYS.dateStart]: null,
  [KEYS.dateEnd]: null,
  [KEYS.categories]: [],
  [KEYS.necessity]: [],
  [KEYS.accounts]: [],
  [KEYS.hideIgnored]: true,
  [KEYS.pageSize]: 50,
  [KEYS.pieScale]: 'total',
  [KEYS.barScale]: 'total',
  [KEYS.ieGroup]: 'category',
};

const cache = {};
const listeners = new Set();

function read(key) {
  const fallback = DEFAULTS[key];
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed === null || parsed === undefined) return fallback;
    // Guard against malformed values for typed keys.
    if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
    if (typeof fallback === 'boolean' && typeof parsed !== 'boolean') return fallback;
    if (typeof fallback === 'number' && typeof parsed !== 'number') return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

function loadAll() {
  for (const key of Object.values(KEYS)) cache[key] = read(key);
}

loadAll();

function emit(key) {
  for (const fn of [...listeners]) {
    try {
      fn(key, cache[key]);
    } catch (err) {
      console.error('[store] listener failed', err);
    }
  }
}

/** Get a persisted value, falling back to its default. */
export function get(key) {
  return key in cache ? cache[key] : DEFAULTS[key];
}

/** Persist a value and notify subscribers. */
export function set(key, value) {
  cache[key] = value;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be unavailable (private mode) — keep in memory */
  }
  emit(key);
}

/** Update without emitting (used when hydrating defaults). */
export function setSilent(key, value) {
  cache[key] = value;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Snapshot of all keys. */
export function snapshot() {
  return { ...cache };
}

/** Remove all b4.* keys and restore defaults. */
export function resetAll() {
  for (const key of Object.values(KEYS)) set(key, DEFAULTS[key]);
}
