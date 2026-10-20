# 0031: The review UI gets the token in the URL fragment and sends it in a header, with no cookie

- Status: Accepted
- Date: 2026-10-16

## Problem

[0001](0001-local-web-app.md) requires the
[review server](../glossary.md#review-server) to require a token, so other web
pages and local processes can't drive it.
[0024](0024-config-file-holds-port-and-token.md) puts the token in the config
file, and has the browser swap a token in a printed URL for a cookie. Until now,
anything that could reach `127.0.0.1:<port>` could call the API, including other
users on the same machine and, through DNS rebinding, web pages in the user's
browser.

A cookie doesn't keep other users out. Cookies aren't separated by port
([RFC 6265, section 8.5](https://www.rfc-editor.org/rfc/rfc6265#section-8.5)),
and `SameSite` ignores ports too, so a cookie set by `127.0.0.1:40723` is sent
to every server on `127.0.0.1`, including one another user runs. Any page served
from localhost would also count as same-site, so the API would need defending
against cross-site request forgery.

## Solution

- **The token.** 32 random bytes from `node:crypto`, encoded as base64url, which
  is 43 characters. `config.json` holds
  `{ "port": <number>, "token": "<token>" }` and stays mode `0600`. The first
  `server start` creates the token, and later starts reuse it. A `config.json`
  without a token isn't valid, so `server start` replaces it with a new port and
  token ([0033](0033-breaking-changes-are-allowed-during-early-development.md)).
- **Every API call carries the token,** including `health`, as
  `Authorization: Bearer <token>`. A call with no token or the wrong one,
  including one to a path under `/api` that isn't a procedure, is rejected
  with 401. The token is compared in constant time. The
  [review UI](../glossary.md#review-ui)'s static files are served without the
  token, because they're the same for every user.
- **The `Host` check.** Every API call is rejected with 403 unless its `Host`
  header is `127.0.0.1:<port>` or `localhost:<port>`, with the review server's
  own port. A call with no `Host` header is rejected too. This blocks DNS
  rebinding, where a page's own domain name resolves to `127.0.0.1` and the
  browser sends that name. The review UI's files are served whatever the `Host`:
  they're the same for every user, and a page that rebinds its domain name gets
  its own origin's `localStorage`, never the token.
- **No CORS.** The review server sends no CORS headers, so browsers keep pages
  from other origins from reading its responses or sending the token header.
- **The printed URL** is `http://127.0.0.1:<port>/#token=<token>`, built in one
  place in `packages/shared`. `server start` prints it when it starts the review
  server, and when it finds one already running.
- **The review UI** reads `#token=` from the URL on any path, saves it in
  `localStorage`, and removes the fragment with `history.replaceState`, without
  reloading. It does the same when only the fragment changes, such as when the
  link is opened in a tab already showing the review UI. A token in the URL
  replaces a saved one. The review UI sends the saved token with every API call
  through `RPCLink`. When it has no token, or the API answers 401, it shows
  "Open the link printed by `agent-diff server start`." instead of the page.
- **No cookie.** The browser never gets a cookie.
- **The CLI** reads the token from the config file and sends it with every call.
  `server start` treats a 401 from `health` on the saved port as not running:
  something else holds the port, such as another user's review server, so it
  starts its own review server, which moves to a new port as 0024 says for a
  taken port. Any other command that gets a 401 fails with "Something on port
  `<port>` rejected the token in `<path to config.json>`. Start the review
  server with `agent-diff server start`.", which is different from
  [0019](0019-cli-does-not-start-the-server.md)'s not-running error, so a wrong
  token isn't reported as a refused connection.
- **Development.** `npm run dev:ui` prints the Vite dev server's URL with the
  token, such as `http://localhost:5173/#token=…`. Vite's proxy sets
  `changeOrigin`, so API calls reach the review server with its own `Host`
  header, and pass the browser's `Authorization` header through.

### Effect on earlier decisions

- **[0024](0024-config-file-holds-port-and-token.md).** The browser doesn't swap
  the token for a cookie. It keeps the token from the printed URL in
  `localStorage` and sends it in a header. This answers 0024's "The cookie"
  follow-up: there's no cookie.

## Tradeoffs

Benefits:

- A fragment is never sent to any server, so the token stays out of request
  lines and server logs.
- `localStorage` is scoped to scheme, host, and port, so another user's review
  server on another port can't read the token, unlike a cookie.
- A token sent in a header can't be sent by another page, because the review
  server sends no CORS headers, so the API needs no defense against cross-site
  request forgery.
- The `Host` check keeps web pages that rebind their domain name to `127.0.0.1`
  out of the API, even before the token is checked.
- The CLI and the review UI authenticate the same way, through one header.

Costs:

- A script injected into the review UI could read the token from `localStorage`.
  Such a script could already call the API.
- The review UI only works when it's opened through a printed URL once per
  browser and origin. `127.0.0.1` and `localhost` are different origins, so each
  needs the link.
- The URL still ends up in terminal scrollback, and the browser's history may
  keep the first visit's URL with the token before the fragment is removed.
- The API can't be reached through any other host name, such as one set up in
  `/etc/hosts` or through a tunnel that rewrites `Host`.
- A page that rebinds its domain name to `127.0.0.1` can read the review UI's
  files, and learn that a review server is running. A route added outside `/api`
  isn't covered by the `Host` check, so it mustn't serve anything that differs
  between users.

## Follow-up design choices

- **Rotating the token.** Still open from 0024. Open tabs would show the message
  until they're opened through a new link.
- **Showing the URL again.** Whether `server status` prints the URL and the
  review UI's message includes it, so the user doesn't need the terminal where
  `server start` ran.
- **Remote and SSH workflows.** A forwarded port keeps the `Host` check as long
  as the forward uses the same port on `localhost` or `127.0.0.1`. Other set-ups
  are open, as in 0001.
