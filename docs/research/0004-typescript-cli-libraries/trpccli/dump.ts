import { deepHelp } from 'trpc-cli';
import { cli } from './cli.ts';

console.log(deepHelp(cli.buildProgram()));
console.log(JSON.stringify(cli.toJSON(), null, 2));
