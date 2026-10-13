import { generateHelpTextForAllCommands } from '@stricli/core';
import { app } from './cli.ts';

for (const [route, text] of generateHelpTextForAllCommands(app)) console.log(`=== ${route}\n${text}`);
