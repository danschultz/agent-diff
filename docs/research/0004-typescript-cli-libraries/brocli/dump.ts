import { commandsInfo } from '@drizzle-team/brocli';
import { commands } from './cli.ts';

console.log(JSON.stringify(commandsInfo(commands), null, 2));
