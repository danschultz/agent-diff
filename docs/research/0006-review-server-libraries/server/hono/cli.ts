import { hc } from 'hono/client';
import type { App } from './server.ts';
import { baseUrl } from './shared/config.ts';
console.log(typeof hc<App>(baseUrl));
