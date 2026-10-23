// Builds the review UI into dist, which the review server serves. The dev
// server proxies API calls to the review server on the port saved in the
// user's config file, so start the review server first. It prints no URL with
// the token: open a session's link from `agent-diff session new` or
// `agent-diff session show` with its origin changed to the dev server's, such
// as `http://localhost:5173/sessions/s_7kq9a1#token=…` (decision 0040).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { apiPrefix } from '@agent-diff/shared/contract';
import { readConfig, serverUrl, statePaths } from '@agent-diff/shared/state';

export default defineConfig(({ command }) => {
  if (command === 'build') return { plugins: [react()] };
  const config = readConfig(statePaths());
  if (!config) {
    throw new Error(
      "The review server hasn't been started, so there's no port to proxy API calls to. Start it with `npx agent-diff server start --foreground`.",
    );
  }
  return {
    plugins: [react()],
    server: {
      proxy: {
        [apiPrefix]: {
          target: serverUrl(config.port),
          // Sends the review server's own Host header, `127.0.0.1:<port>`,
          // which it requires, instead of the dev server's. The browser's
          // Authorization header is passed through.
          changeOrigin: true,
        },
      },
    },
  };
});
