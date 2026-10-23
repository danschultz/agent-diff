// The token the review UI sends with every API call (decision 0031). It
// arrives in the fragment of the URL `agent-diff session new` and
// `agent-diff session show` print, such as
// `http://127.0.0.1:4321/sessions/s_7kq9a1#token=…`, and is read on any path.
// It's kept in localStorage, which is scoped to the review server's origin.
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
