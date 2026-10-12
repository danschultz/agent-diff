// implement: starts headless agent sessions for briefs written as GitHub
// issues. See README.md and docs/decisions/0014-implement-briefs-headlessly.md.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cliClaude, type Claude } from './claude.ts';
import { defaultStateDir, LABELS, loadConfig, mainScript } from './config.ts';
import { run } from './exec.ts';
import { cliGit, type Git } from './git.ts';
import { ghGitHub, type GitHub } from './github.ts';
import { onNotification, onPromptSubmit, type HookInput } from './hook.ts';
import { writeSettingsFile } from './settings.ts';
import { acquireLock, fileStateStore } from './state.ts';
import { tick } from './tick.ts';

const USAGE = `implement

  implement tick [--dry-run]   Reap, resume, and start agent sessions once.
                               --dry-run reads GitHub and git but only logs changes.
  implement status             List tracked briefs and running agent sessions.
  implement setup              Create the agent:* labels on GitHub.
  implement install            Install and start the systemd user timer.
  implement hook <notification|prompt>
                               Claude Code hooks, loaded only in agent sessions
                               started by implement.

Configuration comes from IMPLEMENT_* environment variables; see README.md.
`;

const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);

const [command = 'help', ...args] = process.argv.slice(2);

try {
  switch (command) {
    case 'tick':
      runTick(args.includes('--dry-run'));
      break;
    case 'status':
      status();
      break;
    case 'setup':
      setup();
      break;
    case 'install':
      install();
      break;
    case 'hook':
      hook(args[0]);
      break;
    default:
      process.stdout.write(USAGE);
      if (command !== 'help' && command !== '--help') process.exit(1);
  }
} catch (error) {
  if (command === 'hook') {
    // A hook must never break the agent session.
    console.error(`implement hook: ${(error as Error).message}`);
    process.exit(0);
  }
  console.error(`implement: ${(error as Error).message}`);
  process.exit(1);
}

function runTick(dryRun: boolean): void {
  const config = loadConfig();
  const release = acquireLock(config.stateDir);
  if (!release) {
    log('another tick is running');
    return;
  }
  try {
    const store = fileStateStore(config.stateDir);
    const state = store.load();
    let github = ghGitHub(config.repo);
    let git = cliGit(config.repoDir);
    let claude = cliClaude(config.claudeBin);
    if (dryRun) ({ github, git, claude } = dryRunDeps(github, git, claude));
    tick({
      config,
      github,
      git,
      claude,
      state,
      settingsFile: dryRun ? path.join(config.stateDir, 'settings.json') : writeSettingsFile(config.stateDir),
      now: Date.now,
      sleep: dryRun ? () => {} : (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
      log: dryRun ? (m) => log(`[dry run] ${m}`) : log,
    });
    if (!dryRun) store.save(state);
  } finally {
    release();
  }
}

/** Passes reads through and logs writes instead of making them. */
function dryRunDeps(github: GitHub, git: Git, claude: Claude): { github: GitHub; git: Git; claude: Claude } {
  const would = (what: string) => log(`[dry run] would ${what}`);
  return {
    github: {
      ...github,
      setLabels: (issue, add, remove) => would(`label #${issue} +[${add.join(', ')}] -[${remove.join(', ')}]`),
      comment: (issue, body) => would(`comment on #${issue}:\n${body}`),
    },
    git: {
      addWorktree: (dir, branch, base) => would(`create worktree ${dir} on ${branch} from origin/${base}`),
      removeWorktree: (dir, branch) => would(`remove worktree ${dir} and branch ${branch}`),
      prune: () => would('run git worktree prune'),
    },
    claude: {
      ...claude,
      start: (o) => would(`run in its own systemd scope: claude --bg --remote-control ${o.name} --name ${o.name} --permission-mode auto --settings ${o.settingsFile} <prompt> in ${o.cwd}, with prompt:\n${o.prompt}`),
      resume: (cwd, id, prompt) => would(`run in its own systemd scope: claude --bg --resume ${id} <prompt> in ${cwd}, with prompt:\n${prompt}`),
      stop: (id) => would(`run claude stop ${id}`),
    },
  };
}

function status(): void {
  const config = loadConfig();
  const state = fileStateStore(config.stateDir).load();
  const running = cliClaude(config.claudeBin).running();
  const briefs = Object.values(state.briefs);
  if (briefs.length === 0) console.log('No tracked briefs.');
  for (const b of briefs) {
    const session = running.find((s) => s.sessionId === b.sessionId);
    console.log(`#${b.issue} ${b.title}`);
    console.log(`  branch:        ${b.branch}`);
    console.log(`  worktree:      ${b.worktree}`);
    console.log(`  agent session: ${b.sessionName} ${b.sessionId ?? '(id not known yet)'} ${session ? session.state : 'not running'}`);
  }
}

function setup(): void {
  const config = loadConfig();
  const descriptions: Record<string, [string, string]> = {
    [LABELS.queued]: ['0e8a16', 'Brief is ready for an agent session'],
    [LABELS.working]: ['1d76db', 'An agent session is working on the brief'],
    [LABELS.needsInput]: ['950108', 'Agent needs human input'],
    [LABELS.review]: ['5319e7', "The brief's pull request is ready for review"],
    [LABELS.failed]: ['b60205', 'The agent session exited without a pull request'],
  };
  const existing = new Set(
    (JSON.parse(run('gh', ['label', 'list', '-R', config.repo, '--limit', '200', '--json', 'name'])) as { name: string }[]).map((l) => l.name),
  );
  for (const [name, [color, description]] of Object.entries(descriptions)) {
    if (existing.has(name)) continue;
    run('gh', ['label', 'create', name, '-R', config.repo, '--color', color, '--description', description]);
    log(`created label ${name}`);
  }
  const deletes = run('gh', ['repo', 'view', config.repo, '--json', 'deleteBranchOnMerge', '-q', '.deleteBranchOnMerge']).trim();
  if (deletes !== 'true') {
    log(`${config.repo} doesn't delete head branches after merge. implement relies on it; turn it on with:`);
    log(`  gh repo edit ${config.repo} --delete-branch-on-merge`);
  }
}

function install(): void {
  const config = loadConfig();
  const unitDir = path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'systemd', 'user');
  mkdirSync(unitDir, { recursive: true });
  const env = Object.entries(process.env)
    .filter(([key]) => key.startsWith('IMPLEMENT_'))
    .map(([key, value]) => `Environment=${key}=${value}\n`)
    .join('');
  writeFileSync(
    path.join(unitDir, 'implement.service'),
    `[Unit]
Description=implement: start agent sessions for queued briefs

[Service]
Type=oneshot
WorkingDirectory=${config.repoDir}
Environment=PATH=${path.dirname(process.execPath)}:${path.join(os.homedir(), '.local', 'bin')}:/usr/local/bin:/usr/bin:/bin
${env}ExecStart=${process.execPath} ${mainScript} tick
`,
  );
  writeFileSync(
    path.join(unitDir, 'implement.timer'),
    `[Unit]
Description=Run implement every 2 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
`,
  );
  run('systemctl', ['--user', 'daemon-reload']);
  run('systemctl', ['--user', 'enable', '--now', 'implement.timer']);
  log(`installed implement.service and implement.timer in ${unitDir}`);
  log(`logs: journalctl --user -u implement.service. Run "loginctl enable-linger ${os.userInfo().username}" so the timer runs while you're logged out.`);
}

function hook(event: string | undefined): void {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}') as HookInput;
  const deps = {
    state: fileStateStore(defaultStateDir()).load(),
    github: ghGitHub,
    log: (m: string) => console.error(`implement hook: ${m}`),
  };
  if (event === 'notification') onNotification(input, deps);
  else if (event === 'prompt') onPromptSubmit(input, deps);
  else throw new Error(`unknown hook ${event}`);
}
