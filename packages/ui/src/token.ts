// The token the review UI sends with every API call (decision 0031). It
// arrives in the fragment of the URL `agent-diff server start` prints, such as
// `http://127.0.0.1:4321/#token=…`, on any path, and is kept in localStorage,
// which is scoped to the review server's origin.
const storageKey = 'agent-diff.token';

// Saves a token in the URL's fragment, replacing a saved one, and removes the
// fragment from the address bar without reloading. Returns whether the URL
// had a token. Runs before the review UI renders, and whenever the fragment
// changes.
export function saveTokenFromUrl(): boolean {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (token === null) return false;
  if (token) localStorage.setItem(storageKey, token);
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, '', pathname + search);
  return true;
}

export function savedToken(): string | null {
  return localStorage.getItem(storageKey);
}
