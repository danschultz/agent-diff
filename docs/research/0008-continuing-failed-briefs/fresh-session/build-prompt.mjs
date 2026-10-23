#!/usr/bin/env node
// Builds the prompt for a fresh agent session that takes over from one that exited, using
// only what `implement` can read without the old conversation: the kept scratch dir
// (worktree), the old transcript's last assistant text (implement's own lastAssistantText),
// and the task description.
//
//   node build-prompt.mjs --dir <worktree> --task <task-file> --session-id <old session id>
//        [--ignore a,b,c]    files in the dir to leave out of the listing
//
// There is no git in the scratch dirs of these experiments; a real worktree would also
// give `git status`, `git log` and `git diff --stat` for the branch (see README).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = process.env.AD8_REPO ?? path.resolve(here, '../../../..');
const { lastAssistantText } = await import(
  path.join(repo, 'tools/implement/src/claude.ts')
);

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    task: { type: 'string' },
    'session-id': { type: 'string' },
    ignore: {
      type: 'string',
      default: 'hooks.jsonl,settings.json,state.before.json,start.out',
    },
  },
});
const ignore = new Set(values.ignore.split(','));
const MAX_FILE = 2000;

const files = readdirSync(values.dir, { withFileTypes: true })
  .filter((e) => !ignore.has(e.name))
  .map((e) => {
    const p = path.join(values.dir, e.name);
    const size = e.isFile() ? statSync(p).size : 0;
    const text =
      e.isFile() && size <= MAX_FILE
        ? readFileSync(p, 'utf8').trimEnd()
        : undefined;
    return `- ${e.name}${e.isDirectory() ? '/' : ` (${size} bytes)`}${text ? `: ${JSON.stringify(text)}` : ''}`;
  });
const last = values['session-id']
  ? lastAssistantText(values['session-id'])
  : undefined;

console.log(`You're taking over a task from an agent session that exited before it finished. Nobody is watching this terminal.
You can't see its conversation. Everything it did is in the working directory (${values.dir}), and what's below.

# The task

${readFileSync(values.task, 'utf8').trim()}

# The working directory now

${files.length ? files.join('\n') : '(empty)'}

# What the previous agent session said last

${last ? `> ${last.split('\n').join('\n> ')}` : '(nothing found)'}

# What to do

Check the working directory against the task, don't redo steps that are already done, and finish the rest.`);
