import { treaty } from '@elysiajs/eden';
import type { App } from './server.ts';
import { baseUrl } from './shared/config.ts';
console.log(typeof treaty<App>(baseUrl));
