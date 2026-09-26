// Minimal hash router.
//
// Routes are registered with a definition object:
//   { title, subtitle, filters, render }
// `render(outlet)` may return a cleanup function (e.g. destroyCharts).
// A navigation guard can veto leaving a route (used for unsaved edits).

const routes = new Map();
let defaultPath = '/expenditures';
let outlet = null;
let onRoute = null;
let guard = null;
let currentPath = null;
let currentCleanup = null;
let navSeq = 0;
let suppressNext = false;
let started = false;

function normalize(hash) {
  let path = String(hash || '').replace(/^#/, '');
  if (!path) return defaultPath;
  if (!path.startsWith('/')) path = `/${path}`;
  return path;
}

export function register(path, def) {
  routes.set(path, def);
}

export function init({ outlet: el, defaultRoute = '/expenditures', onRouteChange } = {}) {
  outlet = el;
  defaultPath = defaultRoute;
  onRoute = onRouteChange || null;
  window.addEventListener('hashchange', handleHashChange);
}

export function setGuard(fn) {
  guard = fn;
}

export function current() {
  return currentPath;
}

export function go(path) {
  const target = normalize(path);
  if (normalize(window.location.hash) === target) return;
  window.location.hash = `#${target}`;
}

/** Force a re-render of the current route (bypasses the guard). */
export async function refresh() {
  if (!currentPath) return;
  await navigate(currentPath);
}

export function start() {
  started = true;
  if (!window.location.hash) {
    window.location.hash = `#${defaultPath}`;
    return;
  }
  handleHashChange();
}

async function handleHashChange() {
  if (suppressNext) {
    suppressNext = false;
    return;
  }
  const path = normalize(window.location.hash);
  if (path === currentPath) return;
  if (guard) {
    let ok = true;
    try {
      ok = await guard(currentPath, path);
    } catch (err) {
      console.error('[router] guard error', err);
      ok = true;
    }
    if (!ok) {
      suppressNext = true;
      window.location.hash = `#${currentPath}`;
      return;
    }
  }
  await navigate(path);
}

async function navigate(path) {
  const token = ++navSeq;
  if (currentCleanup) {
    try {
      currentCleanup();
    } catch (err) {
      console.error('[router] cleanup failed', err);
    }
    currentCleanup = null;
  }
  currentPath = path;
  const def = routes.get(path) || routes.get(defaultPath);
  if (!def) {
    if (outlet) {
      outlet.innerHTML =
        '<div class="card"><div class="empty-state"><p>Page not found.</p></div></div>';
    }
    return;
  }
  if (onRoute) onRoute(def, path);
  if (!outlet) return;
  outlet.innerHTML = '';
  try {
    const cleanup = await def.render(outlet);
    if (token !== navSeq) {
      // Superseded while the render was in flight: discard the stale page
      // (its cleanup) without touching currentCleanup.
      if (typeof cleanup === 'function') {
        try {
          cleanup();
        } catch (err) {
          console.error('[router] stale cleanup failed', err);
        }
      }
      return;
    }
    currentCleanup = typeof cleanup === 'function' ? cleanup : null;
  } catch (err) {
    console.error('[router] render failed', err);
    if (token !== navSeq) return;
    outlet.innerHTML = `<div class="card"><div class="empty-state"><p>Failed to render this page: ${String(
      err && err.message ? err.message : err
    ).replace(/[<>&]/g, '')}</p></div></div>`;
  }
}

export function isStarted() {
  return started;
}
