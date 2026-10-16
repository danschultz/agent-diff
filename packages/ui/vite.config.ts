// Builds the review UI into dist, which the review server serves. The dev
// server proxies API calls to the review server on the port saved in the
// user's config file, so start the review server first, and prints its own
// URL with the token from the config file (decision 0031).
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { apiPrefix } from '@agent-diff/shared/contract';
import {
  readConfig,
  reviewUiUrl,
  serverUrl,
  statePaths,
} from '@agent-diff/shared/state';

// Prints the dev server's URL with the token after Vite's own URLs, such as
// `http://localhost:5173/#token=…`. The review UI only works when opened
// through it.
function printUrlWithToken(token: string): Plugin {
  return {
    name: 'agent-diff:print-url-with-token',
    configureServer(server) {
      const printUrls = server.printUrls.bind(server);
      server.printUrls = () => {
        printUrls();
        for (const url of server.resolvedUrls?.local ?? []) {
          server.config.logger.info(
            `  ➜  Open the review UI at ${reviewUiUrl(url, token)}`,
          );
        }
      };
    },
  };
}

export default defineConfig(({ command }) => {
  if (command === 'build') return { plugins: [react()] };
  const config = readConfig(statePaths());
  if (!config?.token) {
    throw new Error(
      "The review server hasn't been started, so there's no port to proxy API calls to or token to send. Start it with `npx agent-diff server start --foreground`.",
    );
  }
  return {
    plugins: [react(), printUrlWithToken(config.token)],
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
