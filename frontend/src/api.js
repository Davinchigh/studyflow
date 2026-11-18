// Every browser gets its own private workspace on the server: a random id kept in this browser.
// Opening a link with ?workspace=<id> moves that workspace to another device.
export const API = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const KEY = 'studyflow-workspace';
const VALID = /^[a-f0-9]{32}$/;

function newId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function resolveWorkspace() {
  const params = new URLSearchParams(window.location.search);
  const fromLink = (params.get('workspace') || '').toLowerCase();
  if (VALID.test(fromLink)) {
    try { localStorage.setItem(KEY, fromLink); } catch { /* storage blocked: still use it for this visit */ }
    params.delete('workspace');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    return fromLink;
  }
  try {
    const saved = localStorage.getItem(KEY);
    if (VALID.test(saved || '')) return saved;
    const created = newId();
    localStorage.setItem(KEY, created);
    return created;
  } catch {
    return newId();
  }
}

export const WORKSPACE = resolveWorkspace();

export function workspaceLink() {
  return `${window.location.origin}${window.location.pathname}?workspace=${WORKSPACE}`;
}

export function apiFetch(url, options = {}) {
  return fetch(url, { ...options, headers: { ...(options.headers || {}), 'X-Workspace': WORKSPACE } });
}
