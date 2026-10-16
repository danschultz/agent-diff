// Builds the review UI into dist, which the review server serves. The dev
// server proxies API calls to the review server on the port saved in the
// user's config file, so start the review server first.
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
      proxy: { [apiPrefix]: serverUrl(config.port) },
    },
  };
});
