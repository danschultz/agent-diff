# 0017: The `agent-diff` CLI is built with Crust

- Status: Accepted
- Date: 2026-10-14

## Problem

[0011](0011-api-core-with-cli-client.md) makes the `agent-diff` CLI the
documented interface for [agents](../glossary.md#agent) and
[harnesses](../glossary.md#harness). Humans use it at a terminal, and agents run
it from a shell. The prototype parses arguments with `node:util` `parseArgs` and
prints a hand-written usage string, so its help can drift from its parser, and
it has no nested subcommands, allowed values, or suggestions. The CLI needs a
library that types parsed arguments from the command definitions, builds help an
agent can learn from, writes clean errors and plain output when piped, and
starts quickly and installs small, since a process starts for every call
([#16](https://github.com/danschultz/agent-diff/issues/16)).

[0004](../research/0004-typescript-cli-libraries.md) compared 20 libraries and
wrote the same example CLI with 17 of them.

## Solution

The CLI is built with [Crust](https://crustjs.com): `@crustjs/core` for
commands, arguments, and flags, and `@crustjs/extensions` for help and "did you
mean" suggestions. From
[0004's example](../research/0004-typescript-cli-libraries/crust/cli.ts):

```ts
const hookClaudeCommand = defineCommand(
  'claude',
  { description: 'Handle a Claude Code hook event.' },
  (c) =>
    c
      .args({
        name: 'event',
        type: 'string',
        choices: HOOK_EVENTS,
        required: true,
        description: 'Hook event',
      })
      .action(({ args }) => hookClaude(args.event)),
);

export const app = new Crust('agent-diff', {
  description: 'Review changes made by coding agents.',
})
  .extend(help(), didYouMean())
  .add(startCommand, reviewCommand, hookCommand);
```

`@crustjs/mcp` isn't used, because 0011 plans no MCP server.

## Tradeoffs

Benefits:

- Parsed arguments are typed from the definitions, with no `any` and no casts.
  `args.event` above is the union of allowed values.
- Nested subcommands, variadic positionals, and allowed values on positionals
  all work. Help lists the allowed values.
- Usage errors go to stderr with exit code 1, unknown flags are rejected without
  a strict mode, a mistyped command gets "did you mean", and piped output has no
  colour codes.
- Small and fast: the example installed 5 packages in 644 KB and started in 374
  ms, against 236 ms for `parseArgs` and 658 ms for incur in the same runs.
- Runs under Node 24 type stripping with no build step.
- Agent-facing features are separate packages, added only when wanted.
  `@crustjs/skills` generates an [Agent Skills](https://agentskills.io) folder
  (`SKILL.md` and a file per command) from the same definitions. Run against
  0004's example on 2026-10-14, it listed each command's arguments, flags,
  defaults, and allowed values.
- `@crustjs/testing` runs commands in tests with captured output.

Costs:

- Young and changing quickly. The repository was created in February 2026, and
  `@crustjs/core` had 36 releases by 2026-10-14, including four minor versions
  from 0.2 to 0.5 between 13 and 28 September. Under 0.x, each can break the
  API, and agents' training data is unlikely to include it.
- One main maintainer: 545 commits, against one or two each from other people,
  when checked on 2026-10-14. The repository had 409 stars.
- Describes itself as Bun-native. It declares `node >= 24` and 0004's example
  ran on Node, but Node may get less attention than Bun.
- Every package declares TypeScript `^7.0.0` as a peer dependency, which ties
  the CLI to TypeScript 7.
- The CLI can't print a full or machine-readable reference by itself. 0004 found
  only incur, Padrone, and Clipanion do. `@crustjs/skills` writes one as files
  at build time instead.
- Help doesn't show a placeholder for a flag's value, such as `--base <ref>`.
- Slower to start than Commander, Stricli, Brocli, and citty, which started
  within about 10 to 70 ms of `parseArgs` in 0004.

## Follow-up design choices

- **Versions.** Whether to pin exact versions while Crust is 0.x, and how
  upgrades are checked.
- **Agent Skills.** Whether the CLI ships a `SKILL.md` generated with
  `@crustjs/skills`, how it reaches agents, and how that fits 0011's benefit
  that nothing is installed into the agent's config. The generated file
  describes each command but not when an agent should use `agent-diff`, which
  would be written by hand.
- **Full reference.** Whether the CLI also prints its whole reference, such as a
  `help --all` command, built from the same command definitions as the skill.
- **Error stream.** Usage errors go to stderr. Agents sometimes discard stderr
  and can't tell a failure from an empty answer, so whether errors, or a pointer
  to them, also go to stdout.
- **Hook commands.** How `hook` commands make sure they never fail the agent,
  for example by exiting 0 on any error. 0004 didn't check this.
- **Output format** and **command set**, left open in 0011.
- **Shell completion** with the `completion()` extension, and **man pages** with
  `@crustjs/man`.
