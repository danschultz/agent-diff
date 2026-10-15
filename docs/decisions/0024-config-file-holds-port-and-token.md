# 0024: A config file in the user's state directory holds their port and token, next to the database

- Status: Accepted
- Date: 2026-10-15

## Problem

Each operating system user runs one review server
([0023](0023-one-review-server-for-every-review-session.md)). The CLI needs to
find that review server's port and authenticate to it, and the browser needs to
authenticate too, which [0001](0001-local-web-app.md),
[0011](0011-api-core-with-cli-client.md), and
[0019](0019-cli-does-not-start-the-server.md) left open. 0001 requires a token,
so that other web pages and local processes can't drive the review server.
[0006](0006-sqlite-review-state.md) left open where the database file lives.

## Solution

- **A directory per user.** Everything is stored in `agent-diff` under
  `$XDG_STATE_HOME`, or under `~/.local/state` when `XDG_STATE_HOME` isn't set,
  on every platform.
- **A config file in it.** The config file holds the user's review server port
  and token. The review server listens on that port, and the CLI reads the file
  to find the review server and to authenticate.
- **Created on first start.** The first `agent-diff server start` creates the
  directory, readable only by the user (`0700`), and the config file, readable
  and writable only by the user (`0600`). It picks a random free port and a
  random token and writes them to the file.
- **Stable across restarts.** Later starts reuse the port and token from the
  file, so the review server's URL stays the same and open browser tabs keep
  working.
- **A taken port is replaced.** If another program is using the saved port when
  `server start` runs, it picks a new random free port and writes it to the
  config file.
- **The token is the user's.** Every API call must carry the token. Other users
  on the same machine can't read the config file, so they can't call the user's
  review server even though it listens on localhost.
- **The browser gets a cookie.** `server start` prints a URL for the review UI
  that carries the token. On the first visit, the review server exchanges the
  token for a cookie, and the browser uses the cookie from then on.
- **The database is next to it.** The user's SQLite database is a file in the
  same directory as the config file.

## Tradeoffs

Benefits:

- The CLI finds and authenticates to the review server by reading one file, with
  nothing to pass on the command line or in the environment.
- A random port avoids clashes between users on one machine, and with other
  programs, without a port to configure.
- Everything the tool stores for a user is in one directory, which is easy to
  inspect, back up, or delete, as 0006 wanted.
- File permissions keep other users out, with no accounts or passwords.
- On Linux, the files are where the XDG Base Directory specification says state
  belongs, and users who set `XDG_STATE_HOME` choose where they go.

Costs:

- The token is only as safe as the file's permissions. Anything running as the
  user, including every agent, can read it and call the review server.
- The token doesn't change, so a leaked token works until it's rotated by hand.
- The URL `server start` prints carries the token, so it can end up in terminal
  scrollback and the browser's history.
- When the saved port is taken and replaced, the review server's URL changes, so
  open browser tabs and URLs printed earlier stop working.
- `~/.local/state` isn't the usual place for application data on macOS or
  Windows.
- Agents in sandboxes and containers that can't see the user's directory can't
  find or call the review server.

## Follow-up design choices

- **File names and format.** The names of the config file and the database, and
  the config file's format.
- **Rotating the token.** A command that replaces the token, and what happens to
  open browser tabs when it does.
- **The cookie.** Its attributes, such as `HttpOnly` and `SameSite=Strict`, how
  long it lasts, and whether the review server redirects to a URL without the
  token after setting it.
- **Opening the browser.** Whether `server start` or another command opens the
  review UI, and where the URL is printed for agents and harnesses such as cmux.
- **Permissions on Windows**, where `0600` and `0700` don't apply.
- **Other settings.** Whether the config file also holds settings such as the
  editors offered by "open in IDE" ([0003](0003-open-in-ide.md)).
- **Sandboxes.** How agents in containers reach the review server, for example
  by mounting the directory or passing the port and token in the environment.
