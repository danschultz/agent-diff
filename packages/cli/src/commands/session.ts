// `agent-diff session` commands, from decisions 0018 and 0040. Their output is
// plain text written for agents.
import path from 'node:path';
import { defineCommand } from '@crustjs/core';
import type {
  Session,
  SessionDetails,
  WorkingDirectory,
} from '@agent-diff/shared/schemas';
import { reviewUiUrl, serverUrl, type Config } from '@agent-diff/shared/state';
import { callReviewServer } from '../client.ts';
import type { Confirm } from '../confirm.ts';

export interface SessionCommandOptions {
  env: NodeJS.ProcessEnv;
  // What relative paths are resolved against.
  cwd: string;
  // Null when there's no terminal to ask in.
  confirm: Confirm | null;
}

// The session's ID, and its title when it has one.
function label({ id, title }: Pick<Session, 'id' | 'title'>): string {
  return title === null ? id : `${id}: ${title}`;
}

// A working directory on its own indented line, such as
// `  /repo (base ref main)`.
function workingDirectoryLine(
  { path, baseRef }: WorkingDirectory,
  ...notes: string[]
): string {
  const base = baseRef === null ? "doesn't use git" : `base ref ${baseRef}`;
  return `  ${path} (${[base, ...notes].join(', ')})`;
}

function url(config: Config, id: string): string {
  return reviewUiUrl(serverUrl(config.port), config.token, id);
}

const sessionIdArg = {
  name: 'session-id',
  type: 'string',
  required: true,
  description: "The session's ID, such as s_7kq9a1",
} as const;

const workingDirsArg = {
  name: 'working-dir',
  type: 'string',
  variadic: true,
  required: true,
  description: 'Directories to review, relative to the current directory',
} as const;

const baseFlag = {
  name: 'base',
  type: 'string',
  description:
    'The ref to compare each working directory that uses git against. By default origin/HEAD, then main or master, then HEAD',
} as const;

export function sessionCommand({ env, cwd, confirm }: SessionCommandOptions) {
  const resolve = (paths: string[]) => paths.map((p) => path.resolve(cwd, p));

  const create = defineCommand(
    'new',
    { description: 'Start a session over one or more working directories.' },
    (c) =>
      c
        .args(workingDirsArg)
        .flags(
          {
            name: 'title',
            type: 'string',
            description: 'A title of up to 200 characters',
          },
          baseFlag,
        )
        .action(async ({ args, flags, stdout }) => {
          const { session, link } = await callReviewServer(
            env,
            async (client, config) => {
              const session = await client.session.new({
                title: flags.title,
                base: flags.base,
                workingDirectories: resolve(args['working-dir']),
              });
              return { session, link: url(config, session.id) };
            },
          );
          stdout(
            [
              `Created session ${session.id}.`,
              `Review UI: ${link}`,
              'Working directories:',
              ...session.workingDirectories.map((w) => workingDirectoryLine(w)),
            ].join('\n'),
          );
        }),
  );

  const add = defineCommand(
    'add',
    { description: 'Add working directories to a session.' },
    (c) =>
      c
        .args(sessionIdArg, workingDirsArg)
        .flags(baseFlag)
        .action(async ({ args, flags, stdout }) => {
          const id = args['session-id'];
          const { workingDirectories } = await callReviewServer(env, (client) =>
            client.session.add({
              id,
              base: flags.base,
              workingDirectories: resolve(args['working-dir']),
            }),
          );
          const added = workingDirectories.filter((w) => !w.alreadyInSession);
          const kept = workingDirectories.filter((w) => w.alreadyInSession);
          const lines: string[] = [];
          if (added.length > 0) {
            lines.push(
              `Added to session ${id}:`,
              ...added.map((w) => workingDirectoryLine(w)),
            );
          }
          if (kept.length > 0) {
            lines.push(
              `Already in session ${id}, and kept as they were:`,
              ...kept.map((w) => workingDirectoryLine(w)),
            );
          }
          stdout(lines.join('\n'));
        }),
  );

  const show = defineCommand(
    'show',
    { description: 'Show a session and its working directories.' },
    (c) =>
      c.args(sessionIdArg).action(async ({ args, stdout }) => {
        const { session, link } = await callReviewServer(
          env,
          async (client, config) => {
            const session: SessionDetails = await client.session.show({
              id: args['session-id'],
            });
            return { session, link: url(config, session.id) };
          },
        );
        stdout(
          [
            `Session ${label(session)}`,
            session.archivedAt === null
              ? 'Status: active'
              : `Status: archived on ${session.archivedAt}`,
            `Created: ${session.createdAt}`,
            `Review UI: ${link}`,
            'Working directories:',
            ...session.workingDirectories.map((w) =>
              w.missing
                ? workingDirectoryLine(w, 'missing on disk')
                : workingDirectoryLine(w),
            ),
          ].join('\n'),
        );
      }),
  );

  const list = defineCommand(
    'list',
    { description: 'List active sessions, newest first.' },
    (c) =>
      c
        .flags({
          name: 'all',
          type: 'boolean',
          default: false,
          description: 'Include archived sessions',
        })
        .action(async ({ flags, stdout }) => {
          const sessions = await callReviewServer(env, (client) =>
            client.session.list({ all: flags.all }),
          );
          if (sessions.length === 0) {
            stdout(
              flags.all
                ? 'There are no sessions.'
                : 'There are no active sessions.',
            );
            return;
          }
          stdout(
            sessions
              .flatMap((session) => [
                `${label(session)} (created ${session.createdAt}${
                  session.archivedAt === null
                    ? ''
                    : `, archived ${session.archivedAt}`
                })`,
                ...session.workingDirectories.map((w) => `  ${w.path}`),
              ])
              .join('\n'),
          );
        }),
  );

  const archive = defineCommand(
    'archive',
    {
      description:
        'Archive a session, which makes it read-only. Archiving is one-way.',
    },
    (c) =>
      c.args(sessionIdArg).action(async ({ args, stdout }) => {
        const id = args['session-id'];
        const { archivedAt, alreadyArchived } = await callReviewServer(
          env,
          (client) => client.session.archive({ id }),
        );
        stdout(
          alreadyArchived
            ? `Session ${id} was already archived on ${archivedAt}.`
            : `Archived session ${id}.`,
        );
      }),
  );

  const remove = defineCommand(
    'delete',
    {
      description:
        'Permanently delete a session, after asking in a terminal. Working directories left in no session are deleted too.',
    },
    (c) =>
      c
        .args(sessionIdArg)
        .flags({
          name: 'yes',
          type: 'boolean',
          default: false,
          description:
            'Delete without asking, which is needed without a terminal',
        })
        .action(async ({ args, flags, stdout }) => {
          const id = args['session-id'];
          if (!flags.yes) {
            // Fails first when the review server isn't running or there's
            // no such session, so nothing is asked in vain.
            const session = await callReviewServer(env, (client) =>
              client.session.show({ id }),
            );
            if (!confirm) {
              throw new Error(
                `There's no terminal to confirm in, so pass --yes to delete session ${id}.`,
              );
            }
            if (
              !(await confirm(`Permanently delete session ${label(session)}?`))
            ) {
              stdout(`Kept session ${id}.`);
              return;
            }
          }
          await callReviewServer(env, (client) =>
            client.session.delete({ id }),
          );
          stdout(`Deleted session ${id}.`);
        }),
  );

  return defineCommand(
    'session',
    { description: 'Manage sessions, which review working directories.' },
    (c) => c.add(create, add, show, list, archive, remove),
  );
}
