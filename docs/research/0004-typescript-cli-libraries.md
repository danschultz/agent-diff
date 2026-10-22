# 0004: Which TypeScript CLI libraries could build the `agent-diff` CLI?

- Date: 2026-10-13

## Question

[Decision 0011](../decisions/0011-api-core-with-cli-client.md) makes the
`agent-diff` CLI the documented interface for agents and harnesses. Humans use
it at a terminal, and agents run it from a shell. The prototype's CLI,
[`prototype/src/cli/main.ts`](../../prototype/src/cli/main.ts), parses arguments
with `node:util` `parseArgs` and prints a hand-written `USAGE` string. This
research looks for a TypeScript library to build the real one
([#16](https://github.com/danschultz/agent-diff/issues/16)).

The candidates are compared on whether they:

- Are written in TypeScript or ship first-class types, with parsed arguments
  typed from the command definitions and no casts.
- Build help into the CLI, so an agent can learn how to use `agent-diff` by
  running it rather than reading a README. That covers `--help` on every
  command, the full reference in one call, machine-readable help, docs generated
  from the same definitions, plain output when stdout isn't a TTY, and usage
  errors that say what was wrong.
- Work for humans: readable help, shell completion, colour on a TTY, good
  errors.
- Support nested subcommands, validation of allowed values, and global options
  such as a possible `--json`.
- Start quickly and install small, since the CLI is installed wherever agents
  run, including sandboxes and containers, and a process starts for every call,
  such as renewing a claim
  ([0011](../decisions/0011-api-core-with-cli-client.md)).
- Run under Node 24 type stripping with no build step, as the repo does
  ([`.node-version`](../../.node-version)).
- Can run a command in-process in tests, and are maintained.

The command set and output format are follow-up design choices in 0011. The
commands below are only a common example to compare libraries with.

## Findings

### How this was checked

The same small CLI was written with every candidate that has typed arguments and
nested subcommands, and with `parseArgs` as a baseline:

```text
agent-diff start [<path>...] [--base <ref>] [--title <text>] [--open]
agent-diff review [--json]
agent-diff hook claude <SessionStart|UserPromptSubmit|Stop>
```

The examples were in `docs/research/0004-typescript-cli-libraries/`, one
directory per library, each with a `package.json` pinning the version checked.
Every example calls the same stubs in
[`shared.ts`](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/shared.ts),
which print the parsed values as JSON, so only the parsing and help code
differs. The event argument for `hook claude` is checked against the allowed
values, by the library where it can, by hand where it can't.

The examples were removed from the repo after this research. Links to them point
to commit
[`15df1d4`](https://github.com/danschultz/agent-diff/tree/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b),
where they can still be read and run.

- **Machine:** Intel Atom C3858 (12 cores, 2.0 GHz), 8 GB RAM, Debian 13.7,
  Linux 6.12. Node 24.21.0 and npm 11.19.0. The repo pins Node 24.20.0, which
  wasn't installed.
- **Running:** each example ran directly with `node cli.ts`, using Node's type
  stripping and no build step. Output was captured with
  [`capture.sh`](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/capture.sh),
  which sends stdout and stderr to files, so neither is a TTY. The environment
  had `TERM=xterm-256color` and `COLORTERM=truecolor`, with `NO_COLOR`,
  `FORCE_COLOR`, and `CI` unset. Commands below are shown as `agent-diff …`;
  they ran as `node cli.ts …` in the example's directory.
- **Type-checking:** in a scratch directory outside the repo, each example was
  installed with `npm install` and checked with TypeScript 7.0.2 (the
  prototype's major version):
  `tsc --strict --noEmit --target es2024 --module nodenext --allowImportingTsExtensions --verbatimModuleSyntax --erasableSyntaxOnly --skipLibCheck`.
  `--erasableSyntaxOnly` rejects syntax that type stripping can't run. The
  checks were repeated with the prototype's
  `--module preserve --moduleResolution bundler`, and without `--skipLibCheck`.
- **`any` probe:** `shared.ts` was temporarily changed so that a call fails to
  compile when any value passed to it is typed `any`. This finds parsed values
  that only type-check because the library returns `any`.
- **Startup:**
  [`bench.mjs`](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/bench.mjs)
  runs `node cli.ts start --help` 5 times to warm up, then 40 times per example,
  interleaved across examples, with output sent to `/dev/null`, and reports the
  median wall-clock time. An empty `cli.ts` measures Node's own startup. A
  second pass of 20 runs enabled Node's on-disk compile cache
  (`NODE_COMPILE_CACHE`,
  [Node docs](https://nodejs.org/api/module.html#module-compile-cache)).
- **Install size:** `npm install` of the pinned versions into an empty
  directory, then `du -sk node_modules` (disk usage, in 4 KB blocks) and the
  number of packages in `package-lock.json`. This includes type-only packages
  such as `@types/yargs` and peer dependencies that npm installs automatically.
- **Maintenance:** the npm registry's `time` field for the latest release and
  the number of releases from 2025-10-13 to 2026-10-13, and the GitHub
  repository's last push and archived flag.

Library behaviour comes from running the examples, from each package's README
and type declarations as installed, and from the linked docs.

### Candidates

All candidates the brief named were checked. Searching for others, including
ones built for agents, found [Clerc](https://clerc.so1ve.dev),
[Padrone](https://github.com/gkurt/padrone),
[cli-forge](https://github.com/AgentEnder/cli-forge), and
[Crust](https://crustjs.com)
([search result](https://dev.to/hongminhee/building-cli-apps-with-typescript-in-2026-5c9d),
[Padrone listing](https://awesome.ecosyste.ms/projects/github.com%2Fkurtgokhan%2Fpadrone),
[cli-forge listing](https://tomevault.io/tome/AgentEnder/cli-forge),
[Crust listing](https://www.everydev.ai/tools/crustjs/llms.txt)), which were
added. [incur](https://github.com/wevm/incur) and Padrone are built for agents.
Crust describes itself as Bun-native, but `@crustjs/core` 0.5.5 declares
`node >= 24` and its example ran on Node.

Some candidates fall short of the brief's criteria, or were checked as a
different package:

- **yargs** doesn't meet the TypeScript criterion. Some of its internals are
  TypeScript, but the package ships no types for its main entry, and the
  community types, [`@types/yargs`](https://www.npmjs.com/package/@types/yargs)
  17.0.35, are for yargs 17 while the latest release is 18.2.0. Its example was
  kept as a reference point. It type-checks with the 17 types.
- **cac** is written in TypeScript, but command actions are typed
  `(...args: any[]) => any`, and it has no nested subcommands. A command named
  `hook claude` printed nothing when run as `hook claude Stop`
  ([README](https://github.com/cacjs/cac#readme); checked by hand).
- **cleye** is TypeScript with typed flags and parameters, but its commands are
  one level deep. `command()` takes no `commands` option
  ([README](https://github.com/privatenumber/cleye#commands)).
- **meow** is JavaScript with a hand-written `index.d.ts`. It has one level of
  commands, and its help is text you write yourself
  ([README](https://github.com/sindresorhus/meow#readme)), so it has no
  generated help.
- **`@effect/cli`** 0.77.2 is the Effect 3 package. In Effect 4, the CLI module
  moved into the `effect` package as `effect/cli`, marked unstable in its
  source. The example uses Effect 4.0.3, the latest release.

### Types and structure

| Library                                                                                                          | Version checked                 | TypeScript                                                       | How parsed arguments are typed                                                                                      | `any` found                                                                                                                                    | Nested subcommands            | Runs with type stripping, no build step                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node:util` `parseArgs`                                                                                          | Node 24.21.0                    | Built in, typed                                                  | Inferred from the `options` object. Positionals are `string[]`. The event needs a cast after a hand-written check.  | No                                                                                                                                             | No. Dispatch by hand.         | Yes                                                                                                                                                                           |
| [Commander](https://github.com/tj/commander.js) + [extra-typings](https://github.com/commander-js/extra-typings) | 15.0.0                          | JavaScript with hand-written typings; extra-typings infers types | Inferred from the `.argument()` and `.option()` strings and `.choices()`                                            | No. `event` is the union.                                                                                                                      | Yes                           | Yes                                                                                                                                                                           |
| [yargs](https://github.com/yargs/yargs)                                                                          | 18.2.0 (`@types/yargs` 17.0.35) | JavaScript entry; types from DefinitelyTyped for v17             | Inferred from the builder chain                                                                                     | No                                                                                                                                             | Yes                           | Yes                                                                                                                                                                           |
| [oclif](https://github.com/oclif/core) (`@oclif/core`)                                                           | 5.1.7                           | TypeScript                                                       | Inferred from static `args` and `flags` on command classes                                                          | Yes. `flags` includes `Record<string, any>`, variadic `argv` is `unknown[]`, and an `options` arg is `string`, so the example needs two casts. | Yes, as topics                | Yes. Command discovery needs a `package.json` `oclif` block and a separate commands module: loading commands from the entry file itself left its top-level `await` unsettled. |
| [Clipanion](https://github.com/arcanis/clipanion)                                                                | 4.0.0-rc.4                      | TypeScript                                                       | Inferred from class fields (`Option.String()` etc.) with [Typanion](https://github.com/arcanis/typanion) validators | No                                                                                                                                             | Yes, as command paths         | Yes                                                                                                                                                                           |
| [citty](https://github.com/unjs/citty)                                                                           | 0.2.2                           | TypeScript                                                       | Inferred from the `args` object                                                                                     | No                                                                                                                                             | Yes                           | Yes                                                                                                                                                                           |
| [gunshi](https://gunshi.dev)                                                                                     | 0.37.3                          | TypeScript                                                       | Inferred from the `args` object                                                                                     | No                                                                                                                                             | Yes                           | Yes                                                                                                                                                                           |
| [cmd-ts](https://github.com/Schniz/cmd-ts)                                                                       | 0.15.0                          | TypeScript                                                       | Inferred from typed parsers such as `oneOf()`                                                                       | No                                                                                                                                             | Yes                           | Yes                                                                                                                                                                           |
| [Stricli](https://bloomberg.github.io/stricli/)                                                                  | 1.3.0                           | TypeScript                                                       | From the handler's parameter types, which the parameter specs are checked against. Handlers need explicit types.    | No                                                                                                                                             | Yes, as route maps            | Yes                                                                                                                                                                           |
| [Effect](https://github.com/Effect-TS/effect) (`effect/cli`)                                                     | 4.0.3                           | TypeScript                                                       | Inferred from `Flag` and `Argument` combinators                                                                     | No                                                                                                                                             | Yes                           | Yes                                                                                                                                                                           |
| [Optique](https://optique.dev)                                                                                   | 1.3.5                           | TypeScript                                                       | Inferred from parser combinators. The result is a discriminated union across commands.                              | No                                                                                                                                             | Yes                           | Yes                                                                                                                                                                           |
| [Brocli](https://github.com/drizzle-team/brocli)                                                                 | 0.12.1                          | TypeScript                                                       | Inferred from option builders                                                                                       | Yes. Inside `subcommands`, `event` is `any`. Outside it, an `.enum()` positional is `string`, not the union.                                   | Yes                           | Yes                                                                                                                                                                           |
| [trpc-cli](https://github.com/mmkal/trpc-cli)                                                                    | 0.17.1 (zod 4.6.7)              | TypeScript                                                       | Inferred from Zod (or other Standard Schema) input schemas                                                          | No                                                                                                                                             | Yes, as nested routers        | Yes                                                                                                                                                                           |
| [incur](https://github.com/wevm/incur)                                                                           | 0.7.0                           | TypeScript                                                       | Inferred from Zod schemas for `args` and `options`                                                                  | No                                                                                                                                             | Yes, by mounting a `Cli`      | Yes                                                                                                                                                                           |
| [Clerc](https://github.com/clercjs/clerc)                                                                        | 1.3.1                           | TypeScript                                                       | Inferred from parameter strings such as `[path...]` and flag types                                                  | No                                                                                                                                             | Yes, as space-separated names | Yes                                                                                                                                                                           |
| [Padrone](https://github.com/gkurt/padrone)                                                                      | 3.0.0 (zod 4.6.7)               | TypeScript                                                       | Inferred from a Zod schema per command                                                                              | No                                                                                                                                             | Yes                           | Yes                                                                                                                                                                           |
| [cli-forge](https://github.com/AgentEnder/cli-forge)                                                             | 1.10.0                          | TypeScript                                                       | Inferred from the builder chain                                                                                     | No                                                                                                                                             | Yes                           | Yes                                                                                                                                                                           |
| [Crust](https://github.com/chenxin-yan/crust) (`@crustjs/core`)                                                  | 0.5.5                           | TypeScript                                                       | Inferred from `args` and `flags` definitions                                                                        | No                                                                                                                                             | Yes                           | Yes                                                                                                                                                                           |
| [cac](https://github.com/cacjs/cac)                                                                              | 7.1.0                           | TypeScript                                                       | Action arguments are `any[]`                                                                                        | Yes                                                                                                                                            | No                            | Not run                                                                                                                                                                       |
| [cleye](https://github.com/privatenumber/cleye)                                                                  | 2.7.0                           | TypeScript                                                       | Inferred from `parameters` and `flags`                                                                              | Not run                                                                                                                                        | One level                     | Not run                                                                                                                                                                       |
| [meow](https://github.com/sindresorhus/meow)                                                                     | 14.1.0                          | JavaScript with hand-written types                               | Inferred from `flags`                                                                                               | Not run                                                                                                                                        | One level                     | Not run                                                                                                                                                                       |

Every example passed `tsc --strict --noEmit` with both module settings. With
`--skipLibCheck` off, the libraries' own declarations had errors in trpc-cli (3,
a missing `json-schema` types package), incur (48, in `@scalar/openapi-types`),
Clerc (2, a missing `update-notifier` types package and an untyped chunk),
Padrone (1), and cli-forge (14). The prototype's `tsconfig.json` sets
`skipLibCheck`.

Variadic positionals and allowed values on a positional, both used by the
example, aren't supported everywhere:

- **Brocli** has no variadic positionals, so its example takes at most one path.
  `start a b` fails with `Unrecognized options for command 'start': b`.
- **citty** and **gunshi** only check allowed values on named options
  (`type: 'enum'`), so `hook claude`'s event is checked by hand in both. citty
  also has no variadic positional; extra positionals arrive in `args._`.
- **cli-forge** takes a variadic positional, but its help shows `[path]`.

### Help

| Library     | Help per command                   | Full reference in one call                 | Machine-readable help                                                       | Allowed values in `hook claude --help` | ANSI codes when piped | Generated docs                                                                                                                      | Shell completion                                                                       |
| ----------- | ---------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `parseArgs` | Hand-written                       | Hand-written                               | No                                                                          | Hand-written                           | No                    | No                                                                                                                                  | No                                                                                     |
| Commander   | Yes, and `help <command>`          | No                                         | No                                                                          | Yes                                    | No                    | No                                                                                                                                  | No                                                                                     |
| yargs       | Yes                                | No                                         | No                                                                          | Yes                                    | No                    | No                                                                                                                                  | bash and zsh, with `.completion()` ([docs](https://yargs.js.org/docs/))                |
| oclif       | Yes, with topics                   | No                                         | No                                                                          | Yes                                    | No                    | Markdown with `oclif readme` from the separate `oclif` dev CLI ([docs](https://github.com/oclif/oclif/blob/main/docs/readme.md))    | [`@oclif/plugin-autocomplete`](https://github.com/oclif/plugin-autocomplete)           |
| Clipanion   | Yes                                | Yes, as JSON                               | `--clipanion=definitions` (with `Builtins.DefinitionsCommand`)              | No                                     | **Yes**               | No                                                                                                                                  | No                                                                                     |
| citty       | Yes                                | No                                         | No                                                                          | Only in description text               | **Yes**               | No                                                                                                                                  | No                                                                                     |
| gunshi      | Yes                                | No                                         | No                                                                          | Only in description text               | No                    | `gunshi/generator` renders usage to a string                                                                                        | [`@gunshi/plugin-completion`](https://www.npmjs.com/package/@gunshi/plugin-completion) |
| cmd-ts      | Yes                                | No                                         | No                                                                          | No                                     | No                    | No                                                                                                                                  | No                                                                                     |
| Stricli     | Yes                                | `generateHelpTextForAllCommands()` API     | No                                                                          | No                                     | No                    | The same API                                                                                                                        | [`@stricli/auto-complete`](https://www.npmjs.com/package/@stricli/auto-complete)       |
| Effect      | Yes                                | No                                         | No                                                                          | No (`event choice`)                    | No                    | No (a `HelpDoc` model in the API)                                                                                                   | Built in: `--completions` for bash, zsh, fish, PowerShell, sh                          |
| Optique     | Yes, and `help <command>`          | Root help lists every command's usage line | No                                                                          | Yes, with `showChoices`                | No                    | Man pages with [`@optique/man`](https://www.npmjs.com/package/@optique/man)                                                         | Built in: `completion` for bash, zsh, fish, PowerShell, Nushell                        |
| Brocli      | Yes                                | `commandsInfo()` API                       | `commandsInfo()` returns JSON-ready objects                                 | Yes, in the usage line                 | No                    | The same API                                                                                                                        | No                                                                                     |
| trpc-cli    | Yes (Commander underneath)         | `deepHelp()` API                           | `toJSON()` API                                                              | No                                     | No                    | The same APIs                                                                                                                       | With [omelette](https://www.npmjs.com/package/omelette), an optional peer              |
| incur       | Yes                                | `--llms-full` (Markdown)                   | `--llms-full --format json` (JSON Schema per command), `<command> --schema` | Yes, in the usage line                 | No                    | `skills add` writes agent skill files                                                                                               | Built in: `completions`                                                                |
| Clerc       | Yes, and `help <command>`          | No                                         | No                                                                          | Yes                                    | No                    | No                                                                                                                                  | `@clerc/plugin-completions`, not enabled by `Cli()`                                    |
| Padrone     | Yes, and `help <command>`          | `--help --detail full`                     | `--help --format json` (also `markdown`, `html`)                            | Yes                                    | No                    | The same `--format` options                                                                                                         | Built in: `completion(shell)`                                                          |
| cli-forge   | Yes, but positionals aren't listed | No                                         | No                                                                          | No                                     | No                    | `cli-forge generate-documentation` writes Markdown, JSON, or `llms.txt`                                                             | bash, zsh, fish, PowerShell scripts in the API                                         |
| Crust       | Yes, with `@crustjs/extensions`    | No                                         | No                                                                          | Yes                                    | No                    | [`@crustjs/man`](https://www.npmjs.com/package/@crustjs/man) and [`@crustjs/skills`](https://www.npmjs.com/package/@crustjs/skills) | `completion()` extension: bash, zsh, fish                                              |

Notes:

- **Colour when piped.** Clipanion and citty wrote ANSI colour codes into piped
  stdout, because they decide colour from `TERM` rather than whether stdout is a
  TTY. Both stopped with `NO_COLOR=1` or `TERM=dumb` (checked by hand).
  Clipanion's
  [source](https://github.com/arcanis/clipanion/blob/master/sources/platform/node.ts)
  uses `tty.WriteStream.prototype.getColorDepth()`, which reads the environment.
  Clipanion's help also draws ruled headers with 256-colour codes.
- **Built-in agent-facing help.** Only incur, Padrone, and Clipanion print a
  full or machine-readable reference from the CLI itself. Stricli, Brocli, and
  trpc-cli expose one through an API, which a `help --all` command could print.
  cli-forge and Crust generate files at build time.
- **incur's `--llms`** lists commands only; `--llms-full` adds arguments and
  options. Its usage line and schema mark `paths` as required although it has a
  default of `[]`, and `start` with no paths ran.
- **gunshi's header.** gunshi printed a header line, the CLI description, before
  every command's output, including the JSON from `start`, until
  `renderHeader: null` was set. Its root help also shows an empty row for the
  required entry command.
- **Stricli** showed `<path>...` in `start --help`, which reads as required,
  although `start` with no paths ran.

### Usage errors

| Library     | `start --nope`                                     | `hook claude Stopp`                | `strat`                                                                                                             | Stream                          | Exit code                                 |
| ----------- | -------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------- |
| `parseArgs` | Node's message, which suggests `--`                | Hand-written                       | Hand-written                                                                                                        | stderr                          | Chosen by the app (2)                     |
| Commander   | Did you mean `--open`?                             | Lists allowed values               | Did you mean `start`?                                                                                               | stderr                          | 1                                         |
| yargs       | `Unknown argument: nope`, after the command's help | Lists allowed values, after help   | Did you mean `start`?, after help                                                                                   | stderr                          | 1                                         |
| oclif       | `Nonexistent flag`, then usage                     | Lists allowed values               | `command strat not found` (suggestions need [`@oclif/plugin-not-found`](https://github.com/oclif/plugin-not-found)) | stderr                          | 2                                         |
| Clipanion   | `Unsupported option name`                          | Lists allowed values               | Lists every command                                                                                                 | **stdout**                      | 1                                         |
| citty       | **Accepted silently**                              | App's own error with a stack trace | `Unknown command`, help on stdout                                                                                   | stderr                          | **0** for the unknown option, 1 otherwise |
| gunshi      | `Unknown option` (needs `strict: true`)            | App's own error                    | `Command not found`                                                                                                 | stdout for parse errors         | 1 (the app catches the rejected promise)  |
| cmd-ts      | Points at the token with `^`                       | Lists allowed values               | Points at the token                                                                                                 | stderr                          | 1                                         |
| Stricli     | Did you mean `--open`?                             | Lists allowed values               | Did you mean `start`?                                                                                               | stderr                          | **252 and 251** (`ExitCode` −4 and −5)    |
| Effect      | Did you mean `--open`?                             | Lists allowed values               | Did you mean `start`?                                                                                               | Help on stdout, error on stderr | 1                                         |
| Optique     | `Unexpected option or subcommand`                  | Lists allowed values               | Did you mean `start`?                                                                                               | stderr                          | 1 (configurable with `errorExitCode`)     |
| Brocli      | `Unrecognized options`                             | Lists allowed values               | `Unknown command`                                                                                                   | stderr                          | 1                                         |
| trpc-cli    | Did you mean `--open`?                             | Lists allowed values               | Did you mean `start`?                                                                                               | stderr                          | 1                                         |
| incur       | `Unknown flag`                                     | Zod's message and issue list       | Did you mean `start`?, with suggested commands                                                                      | **stdout**, as TOON or JSON     | 1                                         |
| Clerc       | `Unexpected flag` (with `strictFlagsPlugin`)       | Lists allowed values               | Did you mean `start`? (with `notFoundPlugin`)                                                                       | stderr                          | 1                                         |
| Padrone     | Did you mean `--open`?                             | Lists allowed values               | Did you mean `start`?                                                                                               | stderr                          | 1                                         |
| cli-forge   | `Unknown argument`, after help (needs `.strict()`) | Lists allowed values, after help   | `Unknown argument: strat`, after help                                                                               | **stdout**                      | 1                                         |
| Crust       | `Unknown flag`                                     | Lists allowed values               | Did you mean `start`? (with `didYouMean()`)                                                                         | stderr                          | 1                                         |

Without `.strict()`, cli-forge accepted `--nope`, and `strat` printed a stack
trace (`agent-diff requires a command`). Without `strict: true`, gunshi accepted
`--nope`. Stricli is the only library that documents distinct exit codes for
usage errors, as its exported `ExitCode` enum, but they're negative numbers,
which the shell sees as 251 and 252.

### Size, startup, and maintenance

Startup is the median of `node cli.ts start --help`. An empty `cli.ts` took 187
ms (85 ms with the compile cache), so Node itself is most of the baseline.

| Library     | Packages installed | Install size | Startup      | With compile cache | Example lines (non-blank)                | Latest release         | Releases in 12 months             | GitHub                         |
| ----------- | ------------------ | ------------ | ------------ | ------------------ | ---------------------------------------- | ---------------------- | --------------------------------- | ------------------------------ |
| `parseArgs` | 0                  | 0            | 238 ms       | 103 ms             | 64 (59)                                  | Node 24                |                                   |                                |
| Commander   | 2                  | 324 KB       | 303 ms       | 164 ms             | 32 (26)                                  | 15.0.0, 2026-05-29     | 3 (+1 pre-release)                | 28.4k stars, pushed 2026-10-12 |
| yargs       | 17                 | 1.2 MB       | 515 ms       | 365 ms             | 46 (44)                                  | 18.2.0, 2026-09-20     | 4 (+2)                            | 11.5k, 2026-10-13              |
| oclif       | 38                 | 3.9 MB       | 621 ms       | 436 ms             | 44 (39), plus 13 lines of `package.json` | 5.1.7, 2026-10-10      | 51 (+1)                           | 318, 2026-10-10                |
| Clipanion   | 2                  | 636 KB       | 322 ms       | 179 ms             | 47 (42)                                  | 4.0.0-rc.4, 2024-09-06 | **0**                             | 1.3k, 2024-09-06               |
| citty       | 1                  | 76 KB        | 245 ms       | 112 ms             | 47 (42)                                  | 0.2.2, 2026-04-01      | 3                                 | 1.3k, 2026-10-13               |
| gunshi      | 1                  | 332 KB       | 290 ms       | 147 ms             | 61 (54)                                  | 0.37.3, 2026-09-16     | 32 (+11)                          | 472, 2026-10-12                |
| cmd-ts      | 7                  | 1.3 MB       | 334 ms       | 192 ms             | 40 (35)                                  | 0.15.0, 2026-02-12     | 2                                 | 365, 2026-04-22                |
| Stricli     | 1                  | 356 KB       | 253 ms       | 116 ms             | 48 (41)                                  | 1.3.0, 2026-07-16      | 10                                | 1.1k, 2026-09-09               |
| Effect      | 14                 | **80 MB**    | **2,752 ms** | 2,303 ms           | 45 (39)                                  | 4.0.3, 2026-10-11      | 36 (+116)                         | 17.3k, 2026-10-13              |
| Optique     | 2                  | 4.1 MB       | 555 ms       | 383 ms             | 57 (51)                                  | 1.3.5, 2026-10-12      | 115 (+790 dev builds)             | 737, 2026-10-13                |
| Brocli      | 1                  | 368 KB       | 252 ms       | 112 ms             | 39 (34)                                  | 0.12.1, 2026-09-04     | 2                                 | 480, 2026-09-04                |
| trpc-cli    | 3                  | 16 MB        | 673 ms       | 471 ms             | 33 (30)                                  | 0.17.1, 2026-10-01     | 13                                | 375, 2026-10-01                |
| incur       | 8                  | 17 MB        | 658 ms       | 456 ms             | 30 (27)                                  | 0.7.0, 2026-10-01      | 81 (first release 2026-02-26)     | 630, 2026-10-01                |
| Clerc       | 16                 | 760 KB       | 541 ms       | 385 ms             | 28 (26)                                  | 1.3.1, 2026-02-22      | 10 (+32)                          | 226, 2026-10-10                |
| Padrone     | 7                  | 15 MB        | 807 ms       | 600 ms             | 36 (34)                                  | 3.0.0, 2026-09-30      | 16 (+4); first release 2025-12-27 | **1**, 2026-09-30              |
| cli-forge   | 3                  | 3.6 MB       | 329 ms       | 188 ms             | 41 (39)                                  | 1.10.0, 2026-04-23     | 22                                | 11, 2026-08-27                 |
| Crust       | 5                  | 644 KB       | 374 ms       | 236 ms             | 40 (34)                                  | 0.5.5, 2026-10-08      | 36; first release 2026-02-18      | 409, 2026-10-09                |
| cac         | 1                  | 68 KB        |              |                    |                                          | 7.1.0, 2026-10-11      | 3 (+1)                            | 3.1k, 2026-10-11               |
| cleye       | 4                  | 332 KB       |              |                    |                                          | 2.7.0, 2026-09-19      | 11 (+2)                           | 694, 2026-09-19                |
| meow        | 1                  | 444 KB       |              |                    |                                          | 14.1.0, 2026-02-20     | 1                                 | 3.7k, 2026-07-21               |

Where the size goes:

- **Effect:** `effect` itself is 56 MB, and `@effect/platform-node` brings
  `undici`, `ws`, and `redis` (15 MB), a peer dependency npm installs. Most of
  the startup time is imports: `import('@effect/platform-node')` alone took 2.2
  s, and importing subpaths (`@effect/platform-node/NodeRuntime`,
  `/NodeServices`) instead of the package root brought the imports to 1.4 s in a
  single run. The Effect 3 package, `@effect/cli` 0.77.2, installs 19 packages
  and 73 MB.
- **trpc-cli, incur, and Padrone:** about 8 MB of each is Zod. incur also
  installs `@modelcontextprotocol/server` (3.5 MB) and `yaml`.
- **oclif:** `@oclif/core` brings 37 packages, including `ejs`, `minimatch`, and
  `supports-color`. oclif can write a command manifest to skip discovery at
  startup, which wasn't tried.

Every library is published under MIT except Stricli, Brocli, and trpc-cli
(Apache-2.0) and cli-forge (ISC). No repository is archived. Clipanion's last
release is a 4.0 release candidate from September 2024, and its repository
hasn't been pushed to since.

### Agent-facing features

- **incur** is built for agents
  ([README](https://github.com/wevm/incur#readme)). Every CLI gets `--llms` and
  `--llms-full` (a Markdown manifest), `--format json` (JSON Schema per
  command), `<command> --schema`, `skills add` (writes agent skill files),
  `--json` and `--format toon|json|yaml|md|jsonl` for command output,
  `--filter-output`, and `--token-limit` for paging long output. Commands return
  values, and incur formats them, defaulting to
  [TOON](https://github.com/toon-format/toon). The `run` context has an `agent`
  flag, true when stdout isn't a TTY. Errors are structured, with a code, and
  can carry suggested next commands. It also serves the CLI as an MCP server
  (`--mcp`, `mcp add`), and as an HTTP API. A command can opt out of MCP with
  `mcp: false`. No root option to remove the MCP built-ins was found in its
  types, and `--json` and `--format` are reserved globally.
- **Padrone** derives help in text, Markdown, HTML, or JSON
  (`--help --format json`), and `--help --detail full` prints every command. It
  also offers an MCP server, a REST server, a Vercel AI SDK tool definition, and
  a REPL, and an extension adds `--json` with a jq subset
  ([README](https://github.com/gkurt/padrone#readme)). Its GitHub repository had
  1 star when checked.
- **cli-forge** generates Markdown, JSON, and an `llms.txt` "for AI agent
  consumption" from the CLI definition, as a build step. Markdown and `llms.txt`
  need `markdown-factory`, an optional peer, installed
  ([README](https://github.com/AgentEnder/cli-forge#readme); checked by hand).
- **Crust** has separate packages to generate agent skills
  ([`@crustjs/skills`](https://www.npmjs.com/package/@crustjs/skills)) and man
  pages, and to serve commands over MCP
  ([`@crustjs/mcp`](https://www.npmjs.com/package/@crustjs/mcp)).
- **gunshi** detects when it runs under an AI coding agent
  ([`gunshi/agent`](https://gunshi.dev/guide/advanced/ai-agent-detection)),
  without changing behaviour by itself.
- **oclif** can add a `--json` flag to a command (`enableJsonFlag`), which
  prints the command's return value as JSON
  ([docs](https://oclif.io/docs/json)).
- **Global options** such as `--json`: yargs options on the root apply to every
  command, Commander exposes them with `optsWithGlobals()`, Effect with
  `Command.withSharedFlags`, Brocli with `globals`, Clerc with `globalFlag()`,
  Padrone with `.globalArgs()`, and Stricli with `global` application flags.
  This came from their docs and types, not from running examples.

### Running commands in tests

These APIs come from each library's docs and types. None was exercised.

| Library     | In-process run with injected arguments and output                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `parseArgs` | A plain function of `argv`. Output is whatever the app writes.                                                                        |
| Commander   | `parseAsync(argv, { from: 'user' })`, `exitOverride()`, `configureOutput({ writeOut, writeErr })`                                     |
| yargs       | `parse(args, context, (err, argv, output) => …)` and `exitProcess(false)`                                                             |
| oclif       | [`@oclif/test`](https://www.npmjs.com/package/@oclif/test) `runCommand()` captures stdout and stderr                                  |
| Clipanion   | `cli.run(argv, { stdout, stderr, stdin })` returns the exit code                                                                      |
| citty       | `runCommand(cmd, { rawArgs })`. Help and errors go through `console`.                                                                 |
| gunshi      | `cli(args, entry, options)`. Output goes through `console`.                                                                           |
| cmd-ts      | `runSafely()` and `dryRun()` return a result instead of exiting                                                                       |
| Stricli     | `run(app, inputs, { process })` with a fake `process` for stdout, stderr, and exit code                                               |
| Effect      | `Command.runWith()` with test layers for `Stdio` and `Terminal`                                                                       |
| Optique     | `run(parser, { args, stdout, stderr, onExit })`, or `parse()` with no I/O                                                             |
| Brocli      | `test(command, args)` parses without running the handler                                                                              |
| trpc-cli    | `cli.run({ argv, process: { exit }, logger })`                                                                                        |
| incur       | `cli.serve(argv, { stdout, exit, env })`                                                                                              |
| Clerc       | `cli.parse({ argv })`. Output goes through `console`.                                                                                 |
| Padrone     | `eval(string)`, `run(name, args)`, `api()`, and `.runtime()` for custom I/O                                                           |
| cli-forge   | `TestHarness.parse(args)`                                                                                                             |
| Crust       | `app.run(path, input)` captures output; `execute({ argv, io })`; [`@crustjs/testing`](https://www.npmjs.com/package/@crustjs/testing) |

### Examples and their output

Each example's source is linked. The output below is exactly what each example
printed with stdout not a TTY, except that ANSI colour codes were removed where
noted, and the scratch directory's path is shown as `<examples>`. A command that
wrote to both streams shows `[stdout]` then `[stderr]`, which is the order of
the blocks, not of the writes. Long output is cut where noted.

#### `node:util` `parseArgs` (baseline)

[Source](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/parseargs/cli.ts).
64 lines (59 non-blank). `start --help` started in 238 ms. Hand-written usage
string and dispatch, with the event checked by hand. Exit code 2 for usage
errors is the example's choice.

<details>
<summary>Output</summary>

`agent-diff --help` (exit 0, stdout):

```text
$ agent-diff --help
Usage: agent-diff <command> [options]

Review changes made by coding agents.

Commands:
  start [<path>...] [--base <ref>] [--title <text>] [--open]
      Start a session over one or more working directories.
      <path>          Working directories to review (default: the current directory)
      --base <ref>    Base ref to compare against
      --title <text>  Title for the session
      --open          Open the review UI in a browser
  review [--json]
      Print the most recent review for the current working directory.
      --json          Print JSON
  hook claude <SessionStart|UserPromptSubmit|Stop>
      Handle a Claude Code hook event.
```

`agent-diff start --help` (exit 0, stdout):

```text
$ agent-diff start --help
Usage: agent-diff <command> [options]

Review changes made by coding agents.

Commands:
  start [<path>...] [--base <ref>] [--title <text>] [--open]
      Start a session over one or more working directories.
      <path>          Working directories to review (default: the current directory)
      --base <ref>    Base ref to compare against
      --title <text>  Title for the session
      --open          Open the review UI in a browser
  review [--json]
      Print the most recent review for the current working directory.
      --json          Print JSON
  hook claude <SessionStart|UserPromptSubmit|Stop>
      Handle a Claude Code hook event.
```

`agent-diff start --nope` (exit 2, stderr):

```text
$ agent-diff start --nope
agent-diff: Unknown option '--nope'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- "--nope"
```

`agent-diff hook claude Stopp` (exit 2, stderr):

```text
$ agent-diff hook claude Stopp
agent-diff: Unknown hook event "Stopp". Expected one of: SessionStart, UserPromptSubmit, Stop
```

`agent-diff strat` (exit 2, stderr):

```text
$ agent-diff strat
agent-diff: Unknown command "strat". Run `agent-diff --help`.
```

</details>

#### Commander with extra-typings

[Source](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/commander/cli.ts).
32 lines (26 non-blank). `start --help` started in 303 ms, against 238 ms for
`parseArgs` in the same run. Default settings.

<details>
<summary>Output</summary>

`agent-diff --help` (exit 0, stdout):

```text
$ agent-diff --help
Usage: agent-diff [options] [command]

Review changes made by coding agents.

Options:
  -h, --help                 display help for command

Commands:
  start [options] [path...]  Start a session over one or more working
                             directories.
  review [options]           Print the most recent review for the current
                             working directory.
  hook                       Handle harness hook events.
  help [command]             display help for command
```

`agent-diff start --help` (exit 0, stdout):

```text
$ agent-diff start --help
Usage: agent-diff start [options] [path...]

Start a session over one or more working directories.

Arguments:
  path            Working directories to review (default: the current directory)

Options:
  --base <ref>    Base ref to compare against
  --title <text>  Title for the session
  --open          Open the review UI in a browser (default: false)
  -h, --help      display help for command
```

`agent-diff start --nope` (exit 1, stderr):

```text
$ agent-diff start --nope
error: unknown option '--nope'
(Did you mean --open?)
```

`agent-diff hook claude Stopp` (exit 1, stderr):

```text
$ agent-diff hook claude Stopp
error: command-argument value 'Stopp' is invalid for argument 'event'. Allowed choices are SessionStart, UserPromptSubmit, Stop.
```

`agent-diff strat` (exit 1, stderr):

```text
$ agent-diff strat
error: unknown command 'strat'
(Did you mean start?)
```

</details>

#### yargs

[Source](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/yargs/cli.ts).
46 lines (44 non-blank). `start --help` started in 515 ms, against 238 ms for
`parseArgs` in the same run. Uses `.strict()`, `.demandCommand(1)`, and
`.recommendCommands()`.

<details>
<summary>Output</summary>

`agent-diff --help` (exit 0, stdout):

```text
$ agent-diff --help
agent-diff <command>

Review changes made by coding agents.

Commands:
  agent-diff start [path..]  Start a session over one or more working
                             directories.
  agent-diff review          Print the most recent review for the current
                             working directory.
  agent-diff hook            Handle harness hook events.

Options:
  --help     Show help                                                 [boolean]
  --version  Show version number                                       [boolean]
```

`agent-diff start --help` (exit 0, stdout):

```text
$ agent-diff start --help
agent-diff start [path..]

Start a session over one or more working directories.

Positionals:
  path  Working directories to review (default: the current directory)
                                                           [array] [default: []]

Options:
  --help     Show help                                                 [boolean]
  --version  Show version number                                       [boolean]
  --base     Base ref to compare against                                [string]
  --title    Title for the session                               [string]
  --open     Open the review UI in a browser          [boolean] [default: false]
```

`agent-diff start --nope` (exit 1, stderr):

```text
$ agent-diff start --nope
agent-diff start [path..]

Start a session over one or more working directories.

Positionals:
  path  Working directories to review (default: the current directory)
                                                           [array] [default: []]

Options:
  --help     Show help                                                 [boolean]
  --version  Show version number                                       [boolean]
  --base     Base ref to compare against                                [string]
  --title    Title for the session                               [string]
  --open     Open the review UI in a browser          [boolean] [default: false]

Unknown argument: nope
```

`agent-diff hook claude Stopp` (exit 1, stderr):

```text
$ agent-diff hook claude Stopp
agent-diff hook claude <event>

Handle a Claude Code hook event.

Positionals:
  event  Hook event
                [required] [choices: "SessionStart", "UserPromptSubmit", "Stop"]

Options:
  --help     Show help                                                 [boolean]
  --version  Show version number                                       [boolean]

Invalid values:
  Argument: event, Given: "Stopp", Choices: "SessionStart", "UserPromptSubmit", "Stop"
```

`agent-diff strat` (exit 1, stderr):

```text
$ agent-diff strat
agent-diff <command>

Review changes made by coding agents.

Commands:
  agent-diff start [path..]  Start a session over one or more working
                             directories.
  agent-diff review          Print the most recent review for the current
                             working directory.
  agent-diff hook            Handle harness hook events.

Options:
  --help     Show help                                                 [boolean]
  --version  Show version number                                       [boolean]

Did you mean start?
```

</details>

#### oclif

44 lines (39 non-blank). `start --help` started in 621 ms, against 238 ms for
`parseArgs` in the same run. Two files,
[`cli.ts`](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/oclif/cli.ts)
and
[`commands.ts`](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/oclif/commands.ts),
plus the `oclif` block in
[`package.json`](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/oclif/package.json).
`start` sets `strict = false` to allow several paths. The version line shows the
example's package name.

<details>
<summary>Output</summary>

`agent-diff --help` (exit 0, stdout):

```text
$ agent-diff --help
VERSION
  agent-diff-oclif/0.0.0 linux-x64 node-v24.21.0

USAGE
  $ agent-diff [COMMAND]

TOPICS
  hook  Handle harness hook events.

COMMANDS
  review  Print the most recent review for the current working directory.
  start   Start a session over one or more working directories.
```

`agent-diff start --help` (exit 0, stdout):

```text
$ agent-diff start --help
Start a session over one or more working directories.

USAGE
  $ agent-diff start [PATH...] [--base <value>] [--title <value>]
    [--open]

ARGUMENTS
  [PATH...]  Working directories to review (default: the current directory)

FLAGS
  --base=<value>   Base ref to compare against
  --open           Open the review UI in a browser
  --title=<value>  Title for the session

DESCRIPTION
  Start a session over one or more working directories.
```

`agent-diff start --nope` (exit 2, stderr):

```text
$ agent-diff start --nope
 ›   Error: Nonexistent flag: --nope
 ›   See more help with --help

USAGE
  $ agent-diff start [PATH...] [--base <value>] [--title <value>]
    [--open]

ARGUMENTS
  [PATH...]  Working directories to review (default: the current directory)

FLAGS
  --base=<value>   Base ref to compare against
  --open           Open the review UI in a browser
  --title=<value>  Title for the session
```

`agent-diff hook claude Stopp` (exit 2, stderr):

```text
$ agent-diff hook claude Stopp
 ›   Error: Expected Stopp to be one of: SessionStart, UserPromptSubmit, Stop
 ›   See more help with --help
```

`agent-diff strat` (exit 2, stderr):

```text
$ agent-diff strat
 ›   Error: command strat not found
```

</details>

#### Clipanion

[Source](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/clipanion/cli.ts).
47 lines (42 non-blank). `start --help` started in 322 ms, against 238 ms for
`parseArgs` in the same run. Registers `Builtins.HelpCommand` and
`Builtins.DefinitionsCommand`.

<details>
<summary>Output</summary>

`agent-diff --help` (exit 0, stdout, ANSI codes removed):

```text
$ agent-diff --help
━━━ agent-diff ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  $ agent-diff <command>

━━━ General commands ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  agent-diff hook claude <event>
    Handle a Claude Code hook event.

  agent-diff review [--json]
    Print the most recent review for the current working directory.

  agent-diff start [--base #0] [--title #0] [--open] ...
    Start a session over one or more working directories.

You can also print more details about any of these commands by calling them with
the `-h,--help` flag right after the command name.
```

`agent-diff start --help` (exit 0, stdout, ANSI codes removed):

```text
$ agent-diff start --help
Start a session over one or more working directories.

━━━ Usage ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

$ agent-diff start ...

━━━ Options ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  --base #0     Base ref to compare against
  --title #0    Title for the session
  --open        Open the review UI in a browser

━━━ Examples ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Review the current directory against main
  $ agent-diff start --base main
```

`agent-diff start --nope` (exit 1, stdout, ANSI codes removed):

```text
$ agent-diff start --nope
Unknown Syntax Error: Unsupported option name ("--nope").

$ agent-diff start [--base #0] [--title #0] [--open] ...
```

`agent-diff hook claude Stopp` (exit 1, stdout, ANSI codes removed):

```text
$ agent-diff hook claude Stopp
Usage Error: Invalid value for event: expected one of "SessionStart", "UserPromptSubmit", or "Stop" (got "Stopp")

$ agent-diff hook claude <event>
```

`agent-diff strat` (exit 1, stdout, ANSI codes removed):

```text
$ agent-diff strat
Unknown Syntax Error: Command not found; did you mean one of:

  0. agent-diff start [--base #0] [--title #0] [--open] ...
  1. agent-diff review [--json]
  2. agent-diff hook claude <event>
  3. agent-diff -h
  4. agent-diff --clipanion=definitions

While running strat
```

`agent-diff --clipanion=definitions` (exit 0, stdout, first 60 lines):

```text
$ agent-diff --clipanion=definitions
[
  {
    "path": "agent-diff start",
    "usage": "agent-diff start ...",
    "description": "Start a session over one or more working directories.\n",
    "examples": [
      [
        "Review the current directory against main\n",
        "agent-diff start --base main"
      ]
    ],
    "options": [
      {
        "preferredName": "--base",
        "nameSet": [
          "--base"
        ],
        "definition": "--base #0",
        "description": "Base ref to compare against",
        "required": false
      },
      {
        "preferredName": "--title",
        "nameSet": [
          "--title"
        ],
        "definition": "--title #0",
        "description": "Title for the session",
        "required": false
      },
      {
        "preferredName": "--open",
        "nameSet": [
          "--open"
        ],
        "definition": "--open",
        "description": "Open the review UI in a browser",
        "required": false
      }
    ]
  },
  {
    "path": "agent-diff review",
    "usage": "agent-diff review",
    "description": "Print the most recent review for the current working directory.\n",
    "options": [
      {
        "preferredName": "--json",
        "nameSet": [
          "--json"
        ],
        "definition": "--json",
        "description": "Print JSON",
        "required": false
      }
    ]
  },
  {
    "path": "agent-diff hook claude",
    "usage": "agent-diff hook claude <event>",
[… 4 more lines]
```

</details>

#### citty

[Source](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/citty/cli.ts).
47 lines (42 non-blank). `start --help` started in 245 ms, against 238 ms for
`parseArgs` in the same run. The event is checked by hand, so its error is the
example's own, thrown from `run`.

<details>
<summary>Output</summary>

`agent-diff --help` (exit 0, stdout, ANSI codes removed):

```text
$ agent-diff --help
Review changes made by coding agents. (agent-diff)

USAGE agent-diff start|review|hook

COMMANDS

   start    Start a session over one or more working directories.
  review    Print the most recent review for the current working directory.
    hook    Handle harness hook events.

Use agent-diff <command> --help for more information about a command.
```

`agent-diff start --help` (exit 0, stdout, ANSI codes removed):

```text
$ agent-diff start --help
Start a session over one or more working directories. (agent-diff start)

USAGE agent-diff start [OPTIONS] [PATH]

ARGUMENTS

  PATH    Working directories to review (default: the current directory)

OPTIONS

    --base=<base>    Base ref to compare against
  --title=<title>    Title for the session
           --open    Open the review UI in a browser (Default: false)
```

`agent-diff start --nope` (exit 0, stdout):

```text
$ agent-diff start --nope
{"command":"start","paths":[],"open":false}
```

`agent-diff hook claude Stopp` (exit 1, stderr):

```text
$ agent-diff hook claude Stopp
Error: Invalid event "Stopp". Expected one of: SessionStart, UserPromptSubmit, Stop
    at Object.run (file://<examples>/citty/cli.ts:32:13)
    at runCommand (file://<examples>/citty/node_modules/citty/dist/index.mjs:228:57)
    at async runCommand (file://<examples>/citty/node_modules/citty/dist/index.mjs:217:5)
    at async runCommand (file://<examples>/citty/node_modules/citty/dist/index.mjs:217:5)
    at async runMain (file://<examples>/citty/node_modules/citty/dist/index.mjs:394:10)
    at async file://<examples>/citty/cli.ts:47:23
```

`agent-diff strat` (exit 1, stdout and stderr, ANSI codes removed):

```text
$ agent-diff strat
[stdout]
Review changes made by coding agents. (agent-diff)

USAGE agent-diff start|review|hook

COMMANDS

   start    Start a session over one or more working directories.
  review    Print the most recent review for the current working directory.
    hook    Handle harness hook events.

Use agent-diff <command> --help for more information about a command.

[stderr]
Unknown command strat
```

</details>

#### gunshi

[Source](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/gunshi/cli.ts).
61 lines (54 non-blank). `start --help` started in 290 ms, against 238 ms for
`parseArgs` in the same run. Sets `strict: true` and `renderHeader: null`, and
catches the promise `cli()` rejects with after printing a usage error. The event
is checked by hand.

<details>
<summary>Output</summary>

`agent-diff --help` (exit 0, stdout):

```text
$ agent-diff --help
USAGE:
  agent-diff [COMMANDS] <OPTIONS>

COMMANDS:
  <OPTIONS>
  hook <OPTIONS>                Handle harness hook events.
  review <OPTIONS>              Print the most recent review for the current working directory.
  start <OPTIONS>               Start a session over one or more working directories.

For more info, run any command with the `--help` flag:
  agent-diff --help
  agent-diff hook --help
  agent-diff review --help
  agent-diff start --help

OPTIONS:
  -h, --help             Display this help message
  -v, --version          Display this version
```

`agent-diff start --help` (exit 0, stdout):

```text
$ agent-diff start --help
Start a session over one or more working directories.

USAGE:
  agent-diff start <OPTIONS> [<path> ...]

ARGUMENTS:
  path           Working directories to review (default: the current directory)

OPTIONS:
  -h, --help               Display this help message
  -v, --version            Display this version
  --base <base>            Base ref to compare against
  --title <title>          Title for the session
  --open                   Open the review UI in a browser (default: false)
```

`agent-diff start --nope` (exit 1, stdout):

```text
$ agent-diff start --nope
Unknown option: --nope
```

`agent-diff hook claude Stopp` (exit 1, stderr):

```text
$ agent-diff hook claude Stopp
Invalid event "Stopp". Expected one of: SessionStart, UserPromptSubmit, Stop
```

`agent-diff strat` (exit 1, stdout):

```text
$ agent-diff strat
Command not found: strat
```

</details>

#### cmd-ts

[Source](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/cmdts/cli.ts).
40 lines (35 non-blank). `start --help` started in 334 ms, against 238 ms for
`parseArgs` in the same run. Default settings.

<details>
<summary>Output</summary>

`agent-diff --help` (exit 0, stdout):

```text
$ agent-diff --help
agent-diff <subcommand>
> Review changes made by coding agents.

where <subcommand> can be one of:

- start - Start a session over one or more working directories.
- review - Print the most recent review for the current working directory.
- hook - Handle harness hook events.

For more help, try running `agent-diff <subcommand> --help`
```

`agent-diff start --help` (exit 0, stdout):

```text
$ agent-diff start --help
agent-diff start
> Start a session over one or more working directories.

ARGUMENTS:
  [...path] - Working directories to review (default: the current directory)

OPTIONS:
  --base <str>  - Base ref to compare against [optional]
  --title <str> - Title for the session [optional]

FLAGS:
  --open     - Open the review UI in a browser [optional]
  --help, -h - show help [optional]
```

`agent-diff start --nope` (exit 1, stderr):

```text
$ agent-diff start --nope
error: found 1 error

  agent-diff start --nope
                   ^ Unknown arguments


hint: for more information, try 'agent-diff start --help'
```

`agent-diff hook claude Stopp` (exit 1, stderr):

```text
$ agent-diff hook claude Stopp
error: found 1 error

  agent-diff hook claude Stopp
                         ^ Invalid value 'Stopp'. Expected one of: 'SessionStart', 'UserPromptSubmit', 'Stop'


hint: for more information, try 'agent-diff hook claude --help'
```

`agent-diff strat` (exit 1, stderr):

```text
$ agent-diff strat
error: found 1 error

  agent-diff strat
             ^ Not a valid subcommand name


hint: for more information, try 'agent-diff --help'
```

</details>

#### Stricli

[Source](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/stricli/cli.ts).
48 lines (41 non-blank). `start --help` started in 253 ms, against 238 ms for
`parseArgs` in the same run. Default settings.
[`dump.ts`](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/stricli/dump.ts)
prints `generateHelpTextForAllCommands()`.

<details>
<summary>Output</summary>

`agent-diff --help` (exit 0, stdout):

```text
$ agent-diff --help
USAGE
  agent-diff start [--base ref] [--title text] [--open] <path>...
  agent-diff review [--json]
  agent-diff hook claude ...
  agent-diff --help

Review changes made by coding agents.

FLAGS
  -h --help  Print help information and exit

COMMANDS
  start   Start a session over one or more working directories.
  review  Print the most recent review for the current working directory.
  hook    Handle harness hook events.
```

`agent-diff start --help` (exit 0, stdout):

```text
$ agent-diff start --help
USAGE
  agent-diff start [--base ref] [--title text] [--open] <path>...
  agent-diff start --help

Start a session over one or more working directories.

FLAGS
     [--base]   Base ref to compare against
     [--title]  Title for the session
     [--open]   Open the review UI in a browser [default = false]
  -h  --help    Print help information and exit

ARGUMENTS
  path...  Working directories to review (default: the current directory)
```

`agent-diff start --nope` (exit 252, stderr):

```text
$ agent-diff start --nope
No flag registered for --nope, did you mean --open?
```

`agent-diff hook claude Stopp` (exit 252, stderr):

```text
$ agent-diff hook claude Stopp
Failed to parse "Stopp" for event: Stopp is not one of (SessionStart|UserPromptSubmit|Stop)
```

`agent-diff strat` (exit 251, stderr):

```text
$ agent-diff strat
No command registered for `strat`, did you mean `start`?
```

`agent-diff --helpAll` (exit 0, stdout):

```text
$ agent-diff --helpAll
USAGE
  agent-diff start [--base ref] [--title text] [--open] <path>...
  agent-diff review [--json]
  agent-diff hook claude ...
  agent-diff --help
  agent-diff --helpAll

Review changes made by coding agents.

FLAGS
  -h --help     Print help information and exit
  -H --helpAll  Print help information (including hidden commands/flags) and exit

COMMANDS
  start   Start a session over one or more working directories.
  review  Print the most recent review for the current working directory.
  hook    Handle harness hook events.
```

`node dump.ts` (exit 0, stdout):

```text
$ node dump.ts
=== agent-diff start
USAGE
  agent-diff start [--base ref] [--title text] [--open] <path>...
  agent-diff start --help

Start a session over one or more working directories.

FLAGS
     [--base]   Base ref to compare against
     [--title]  Title for the session
     [--open]   Open the review UI in a browser [default = false]
  -h  --help    Print help information and exit

ARGUMENTS
  path...  Working directories to review (default: the current directory)

=== agent-diff review
USAGE
  agent-diff review [--json]
  agent-diff review --help

Print the most recent review for the current working directory.

FLAGS
     [--json]  Print JSON                      [default = false]
  -h  --help   Print help information and exit

=== agent-diff hook claude
USAGE
  agent-diff hook claude <event>
  agent-diff hook claude --help

Handle a Claude Code hook event.

FLAGS
  -h --help  Print help information and exit

ARGUMENTS
  event  Hook event
```

</details>

#### Effect (`effect/cli`)

[Source](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/effect/cli.ts).
45 lines (39 non-blank). `start --help` started in 2752 ms, against 238 ms for
`parseArgs` in the same run. Uses `@effect/platform-node` for the runtime.

<details>
<summary>Output</summary>

`agent-diff --help` (exit 0, stdout):

```text
$ agent-diff --help
DESCRIPTION
  Review changes made by coding agents.

USAGE
  agent-diff <subcommand> [flags]

GLOBAL FLAGS
  --help, -h                                                          Show help information
  --version, -v                                                       Show version information
  --wizard                                                            Start wizard mode for a command
  --completions <bash|zsh|fish|powershell|sh|pwsh>                    Print shell completion script (choices: bash, zsh, fish, powershell, sh, pwsh)
  --log-level <all|trace|debug|info|warn|warning|error|fatal|none>    Sets the minimum log level (choices: all, trace, debug, info, warn, warning, error, fatal, none)

SUBCOMMANDS
  start     Start a session over one or more working directories.
  review    Print the most recent review for the current working directory.
  hook      Handle harness hook events.
```

`agent-diff start --help` (exit 0, stdout):

```text
$ agent-diff start --help
DESCRIPTION
  Start a session over one or more working directories.

USAGE
  agent-diff start [flags] [<path...>]

ARGUMENTS
  path... string    Working directories to review (default: the current directory) (optional)

FLAGS
  --base string     Base ref to compare against
  --title string    Title for the session
  --open            Open the review UI in a browser

GLOBAL FLAGS
  --help, -h                                                          Show help information
  --version, -v                                                       Show version information
  --wizard                                                            Start wizard mode for a command
  --completions <bash|zsh|fish|powershell|sh|pwsh>                    Print shell completion script (choices: bash, zsh, fish, powershell, sh, pwsh)
  --log-level <all|trace|debug|info|warn|warning|error|fatal|none>    Sets the minimum log level (choices: all, trace, debug, info, warn, warning, error, fatal, none)
```

`agent-diff start --nope` (exit 1, stdout and stderr):

```text
$ agent-diff start --nope
[stdout]
DESCRIPTION
  Start a session over one or more working directories.

USAGE
  agent-diff start [flags] [<path...>]

ARGUMENTS
  path... string    Working directories to review (default: the current directory) (optional)

FLAGS
  --base string     Base ref to compare against
  --title string    Title for the session
  --open            Open the review UI in a browser

GLOBAL FLAGS
  --help, -h                                                          Show help information
  --version, -v                                                       Show version information
  --wizard                                                            Start wizard mode for a command
  --completions <bash|zsh|fish|powershell|sh|pwsh>                    Print shell completion script (choices: bash, zsh, fish, powershell, sh, pwsh)
  --log-level <all|trace|debug|info|warn|warning|error|fatal|none>    Sets the minimum log level (choices: all, trace, debug, info, warn, warning, error, fatal, none)
[stderr]

ERROR
  Unrecognized flag: --nope in command agent-diff start

  Did you mean this?
    --open
```

`agent-diff hook claude Stopp` (exit 1, stdout and stderr):

```text
$ agent-diff hook claude Stopp
[stdout]
DESCRIPTION
  Handle a Claude Code hook event.

USAGE
  agent-diff hook claude [flags] <event>

ARGUMENTS
  event choice    Hook event

GLOBAL FLAGS
  --help, -h                                                          Show help information
  --version, -v                                                       Show version information
  --wizard                                                            Start wizard mode for a command
  --completions <bash|zsh|fish|powershell|sh|pwsh>                    Print shell completion script (choices: bash, zsh, fish, powershell, sh, pwsh)
  --log-level <all|trace|debug|info|warn|warning|error|fatal|none>    Sets the minimum log level (choices: all, trace, debug, info, warn, warning, error, fatal, none)
[stderr]

ERROR
  Invalid value for argument <event>: "Stopp". Expected: "SessionStart" | "UserPromptSubmit" | "Stop"
```

`agent-diff strat` (exit 1, stdout and stderr):

```text
$ agent-diff strat
[stdout]
DESCRIPTION
  Review changes made by coding agents.

USAGE
  agent-diff <subcommand> [flags]

GLOBAL FLAGS
  --help, -h                                                          Show help information
  --version, -v                                                       Show version information
  --wizard                                                            Start wizard mode for a command
  --completions <bash|zsh|fish|powershell|sh|pwsh>                    Print shell completion script (choices: bash, zsh, fish, powershell, sh, pwsh)
  --log-level <all|trace|debug|info|warn|warning|error|fatal|none>    Sets the minimum log level (choices: all, trace, debug, info, warn, warning, error, fatal, none)

SUBCOMMANDS
  start     Start a session over one or more working directories.
  review    Print the most recent review for the current working directory.
  hook      Handle harness hook events.
[stderr]

ERROR
  Unknown subcommand "strat" for "agent-diff"

  Did you mean this?
    start
```

`agent-diff --completions bash` (exit 0, stdout, first 30 lines):

```text
$ agent-diff --completions bash
###-begin-agent-diff-completions-###
#
# Static completion script for Bash
#
# Installation:
#   agent-diff --completions bash >> ~/.bashrc
#

if ! type _init_completion &>/dev/null; then
  _init_completion()
  {
    COMPREPLY=()
    local _i _j=0 _piece _line="$COMP_LINE"
    words=("${COMP_WORDS[0]}")
    cword=0
    _line="${_line#*"${COMP_WORDS[0]}"}"
    for ((_i = 1; _i < ${#COMP_WORDS[@]}; _i++)); do
      _piece="${COMP_WORDS[_i]}"
      if [[ "$_line" == [[:blank:]]* ]]; then
        ((_j++))
        words[_j]="$_piece"
      else
        words[_j]="${words[_j]}$_piece"
      fi
      ((_i == COMP_CWORD)) && cword=$_j
      _line="${_line#*"$_piece"}"
    done
    cur="${words[cword]}"
    prev=""
    ((cword > 0)) && prev="${words[cword-1]}"
[… 203 more lines]
```

</details>

#### Optique

[Source](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/optique/cli.ts).
57 lines (51 non-blank). `start --help` started in 555 ms, against 238 ms for
`parseArgs` in the same run. Turns on the `help` command and option, the
`completion` command, and `showChoices`.

<details>
<summary>Output</summary>

`agent-diff --help` (exit 0, stdout):

```text
$ agent-diff --help
Review changes made by coding agents.
Usage: agent-diff start [--base REF] [--title TEXT] [--open] [PATH...]
       agent-diff review [--json]
       agent-diff hook claude EVENT
       agent-diff help [COMMAND...]
       agent-diff completion [SHELL] [ARG...]
       agent-diff --help

  start                       Start a session over one or more working directories.
  review                      Print the most recent review for the current working directory.
  hook                        Handle harness hook events.
  help                        Show help information.
  completion                  Generate shell completion script or provide completions.
  --help                      Show help information.
```

`agent-diff start --help` (exit 0, stdout):

```text
$ agent-diff start --help
Usage: agent-diff start [--base REF] [--title TEXT] [--open] [PATH...]

Start a session over one or more working directories.

  --base REF                  Base ref to compare against
  --title TEXT                Title for the session
  --open                      Open the review UI in a browser
  PATH                        Working directories to review (default: the current directory)
```

`agent-diff start --nope` (exit 1, stderr):

```text
$ agent-diff start --nope
Usage: agent-diff --help
       agent-diff start [--base REF] [--title TEXT] [--open] [PATH...]
       agent-diff review [--json]
       agent-diff hook claude EVENT
       agent-diff completion [--help] [SHELL] [ARG...]
       agent-diff help [COMMAND...]
Error: Unexpected option or subcommand: `--nope`.
```

`agent-diff hook claude Stopp` (exit 1, stderr):

```text
$ agent-diff hook claude Stopp
Usage: agent-diff --help
       agent-diff start [--base REF] [--title TEXT] [--open] [PATH...]
       agent-diff review [--json]
       agent-diff hook claude EVENT
       agent-diff completion [--help] [SHELL] [ARG...]
       agent-diff help [COMMAND...]
Error: `EVENT`: Expected one of "SessionStart", "UserPromptSubmit", and "Stop", but got "Stopp".
```

`agent-diff strat` (exit 1, stderr):

```text
$ agent-diff strat
Usage: agent-diff --help
       agent-diff start [--base REF] [--title TEXT] [--open] [PATH...]
       agent-diff review [--json]
       agent-diff hook claude EVENT
       agent-diff completion [--help] [SHELL] [ARG...]
       agent-diff help [COMMAND...]
Error: Unexpected option or subcommand: `strat`.

Did you mean `start`?
```

`agent-diff help hook claude` (exit 0, stdout):

```text
$ agent-diff help hook claude
Usage: agent-diff hook claude EVENT

Handle a Claude Code hook event.

  EVENT                       Hook event (choices: SessionStart, UserPromptSubmit, Stop)
```

`agent-diff completion bash` (exit 0, stdout, first 30 lines):

```text
$ agent-diff completion bash

function _agent-diff () {
  COMPREPLY=()
  local current="${COMP_WORDS[COMP_CWORD]}"
  local prev=("${COMP_WORDS[@]:1:COMP_CWORD-1}")
  while IFS= read -r line; do
    if [[ "$line" == __FILE__:* ]]; then
      # Parse file completion directive: __FILE__:type:extensions:pattern:hidden
      IFS=':' read -r _ type extensions pattern hidden <<< "$line"
      extensions="${extensions//,\./,}"; extensions="${extensions#.}"
      pattern="${pattern//%3A/:}"; pattern="${pattern//%25/%}"

      # Save and adjust glob/shell options for safe file completion
      local __dotglob_was_set=0 __failglob_was_set=0 __noglob_was_set=0
      local __globignore_was_set=0 __saved_globignore="${GLOBIGNORE-}"
      [[ ${GLOBIGNORE+x} == x ]] && __globignore_was_set=1
      shopt -q dotglob && __dotglob_was_set=1
      shopt -q failglob && __failglob_was_set=1
      [[ $- == *f* ]] && __noglob_was_set=1
      # Unset GLOBIGNORE before enabling dotglob because unsetting
      # GLOBIGNORE implicitly clears dotglob in Bash
      shopt -u failglob 2>/dev/null
      set +f
      unset GLOBIGNORE

      # Expand tilde prefix for file globbing
      local __glob_current="$current" __tilde_prefix="" __tilde_expanded=""
      if [[ "$current" =~ ^(~[a-zA-Z0-9_.+-]*)(/.*)$ ]]; then
        __tilde_prefix="${BASH_REMATCH[1]}"
        eval "__tilde_expanded=$__tilde_prefix" 2>/dev/null || true
[… 189 more lines]
```

</details>

#### Brocli

[Source](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/brocli/cli.ts).
39 lines (34 non-blank). `start --help` started in 252 ms, against 238 ms for
`parseArgs` in the same run. Takes at most one path.
[`dump.ts`](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/brocli/dump.ts)
prints `commandsInfo()`.

<details>
<summary>Output</summary>

`agent-diff --help` (exit 0, stdout):

```text
$ agent-diff --help
Review changes made by coding agents.

Usage:
  agent-diff [command]

Available Commands:
  start    Start a session over one or more working directories.
  review   Print the most recent review for the current working directory.
  hook     Handle harness hook events.

Flags:
  -h, --help      help for agent-diff
  -v, --version   version for agent-diff
```

`agent-diff start --help` (exit 0, stdout):

```text
$ agent-diff start --help

Start a session over one or more working directories.

Usage:
  agent-diff start [path] [flags]

Flags:
      --base string    Base ref to compare against
      --title string   Title for the session
      --open           Open the review UI in a browser (default: false)
  -h, --help           help for start
  -v, --version        version for agent-diff
```

`agent-diff start --nope` (exit 1, stderr):

```text
$ agent-diff start --nope
Unrecognized options for command 'start': --nope
```

`agent-diff hook claude Stopp` (exit 1, stderr):

```text
$ agent-diff hook claude Stopp
Invalid value: value for the positional argument 'event' must be either one of the following: SessionStart, UserPromptSubmit, Stop; Received: Stopp
```

`agent-diff strat` (exit 1, stderr):

```text
$ agent-diff strat
Unknown command: 'strat'.
Type '--help' to get help on the cli.
```

`node dump.ts` (exit 0, stdout):

```text
$ node dump.ts
{
  "start": {
    "name": "start",
    "desc": "Start a session over one or more working directories.",
    "options": {
      "path": {
        "aliases": [],
        "type": "positional",
        "name": "path",
        "description": "Working directory to review (default: the current directory)"
      },
      "base": {
        "aliases": [],
        "type": "string",
        "name": "--base",
        "description": "Base ref to compare against"
      },
      "title": {
        "aliases": [],
        "type": "string",
        "name": "--title",
        "description": "Title for the session"
      },
      "open": {
        "aliases": [],
        "type": "boolean",
        "name": "--open",
        "description": "Open the review UI in a browser",
        "default": false
      }
    }
  },
  "review": {
    "name": "review",
    "desc": "Print the most recent review for the current working directory.",
    "options": {
      "json": {
        "aliases": [],
        "type": "boolean",
        "name": "--json",
        "description": "Print JSON",
        "default": false
      }
    }
  },
  "hook": {
    "name": "hook",
    "desc": "Handle harness hook events.",
    "subcommands": {
      "claude": {
        "name": "claude",
        "desc": "Handle a Claude Code hook event.",
        "options": {
          "event": {
            "aliases": [],
            "type": "positional",
            "name": "event",
            "description": "Hook event",
            "enumVals": [
              "SessionStart",
              "UserPromptSubmit",
              "Stop"
            ],
            "isRequired": true
          }
        }
      }
    }
  }
}
```

</details>

#### trpc-cli

[Source](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/trpccli/cli.ts).
33 lines (30 non-blank). `start --help` started in 673 ms, against 238 ms for
`parseArgs` in the same run. Uses trpc-cli's standalone `t` router with Zod,
without `@trpc/server`.
[`dump.ts`](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/trpccli/dump.ts)
prints `deepHelp()` and `toJSON()`.

<details>
<summary>Output</summary>

`agent-diff --help` (exit 0, stdout):

```text
$ agent-diff --help
Usage: agent-diff [options] [command]

Review changes made by coding agents.
Available subcommands: start, review, hook

Options:
  -h, --help                 display help for command

Commands:
  start [options] [path...]  Start a session over one or more working
                             directories.
  review [options]           Print the most recent review for the current
                             working directory.
  hook                       Available subcommands: claude
  help [command]             display help for command
```

`agent-diff start --help` (exit 0, stdout):

```text
$ agent-diff start --help
Usage: agent-diff start [options] [path...]

Start a session over one or more working directories.

Arguments:
  path              array path

Options:
  --base [string]   Base ref to compare against
  --title [string]  Title for the session
  --open [boolean]  Open the review UI in a browser (default: false)
  -h, --help        display help for command
```

`agent-diff start --nope` (exit 1, stderr):

```text
$ agent-diff start --nope
error: unknown option '--nope'
(Did you mean --open?)



Usage: agent-diff start [options] [path...]

Start a session over one or more working directories.

Arguments:
  path              array path

Options:
  --base [string]   Base ref to compare against
  --title [string]  Title for the session
  --open [boolean]  Open the review UI in a browser (default: false)
  -h, --help        display help for command
```

`agent-diff hook claude Stopp` (exit 1, stderr):

```text
$ agent-diff hook claude Stopp
error: command-argument value 'Stopp' is invalid for argument 'value'. Invalid option: expected one of "SessionStart"|"UserPromptSubmit"|"Stop"

Usage: agent-diff hook claude [options] <value>

Handle a Claude Code hook event.

Arguments:
  value       event (required)

Options:
  -h, --help  display help for command
```

`agent-diff strat` (exit 1, stderr):

```text
$ agent-diff strat
error: unknown command 'strat'
(Did you mean start?)



Usage: agent-diff [options] [command]

Review changes made by coding agents.
Available subcommands: start, review, hook

Options:
  -h, --help                 display help for command

Commands:
  start [options] [path...]  Start a session over one or more working
                             directories.
  review [options]           Print the most recent review for the current
                             working directory.
  hook                       Available subcommands: claude
  help [command]             display help for command
```

`node dump.ts` (exit 0, stdout, first 80 lines):

```text
$ node dump.ts
=== agent-diff ===
Usage: agent-diff [options] [command]

Review changes made by coding agents.
Available subcommands: start, review, hook

Options:
  -h, --help                 display help for command

Commands:
  start [options] [path...]  Start a session over one or more working
                             directories.
  review [options]           Print the most recent review for the current
                             working directory.
  hook                       Available subcommands: claude
  help [command]             display help for command

=== agent-diff start ===
Usage: agent-diff start [options] [path...]

Start a session over one or more working directories.

Arguments:
  path              array path

Options:
  --base [string]   Base ref to compare against
  --title [string]  Title for the session
  --open [boolean]  Open the review UI in a browser (default: false)
  -h, --help        display help for command

=== agent-diff review ===
Usage: agent-diff review [options]

Print the most recent review for the current working directory.

Options:
  --json [boolean]  Print JSON (default: false)
  -h, --help        display help for command

=== agent-diff hook ===
Usage: agent-diff hook [options] [command]

Available subcommands: claude

Options:
  -h, --help      display help for command

Commands:
  claude <value>  Handle a Claude Code hook event.
  help [command]  display help for command

=== agent-diff hook claude ===
Usage: agent-diff hook claude [options] <value>

Handle a Claude Code hook event.

Arguments:
  value       event (required)

Options:
  -h, --help  display help for command

{
  "name": "agent-diff",
  "description": "Review changes made by coding agents.\nAvailable subcommands: start, review, hook",
  "usage": "[options] [command]",
  "arguments": [],
  "options": [],
  "commands": [
    {
      "name": "start",
      "description": "Start a session over one or more working directories.",
      "usage": "[options] [path...]",
      "arguments": [
        {
          "name": "path",
          "variadic": true,
          "required": false,
          "description": "array path"
[… 81 more lines]
```

</details>

#### incur

[Source](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/incur/cli.ts).
30 lines (27 non-blank). `start --help` started in 658 ms, against 238 ms for
`parseArgs` in the same run. `review` doesn't declare `--json`, because incur
reserves it as a global option, and reads the chosen format instead.

<details>
<summary>Output</summary>

`agent-diff --help` (exit 0, stdout):

```text
$ agent-diff --help
agent-diff@0.0.0 — Review changes made by coding agents.

Usage: agent-diff <command>

Commands:
  hook    Handle harness hook events.
  review  Print the most recent review for the current working directory.
  start   Start a session over one or more working directories.

Integrations:
  completions  Generate shell completion script
  mcp          Register as MCP server (add, doctor)
  skills       Sync skill files to agents (add, list)

Global Options:
  --filter-output <keys>              Filter output by key paths (e.g. foo,bar.baz,a[0,3])
  --format <toon|json|yaml|md|jsonl>  Output format
  --full-output                       Show full output envelope
  --help                              Show help
  --llms, --llms-full                 Print LLM-readable manifest
  --mcp                               Start as MCP stdio server
  --schema                            Show JSON Schema for command
  --token-count                       Print token count of output (instead of output)
  --token-limit <n>                   Limit output to n tokens
  --token-offset <n>                  Skip first n tokens of output
  --update                            Update to latest version
  --version                           Show version
```

`agent-diff start --help` (exit 0, stdout):

```text
$ agent-diff start --help
agent-diff start — Start a session over one or more working directories.

Usage: agent-diff start <paths...> [options]

Arguments:
  paths  Working directories to review (default: the current directory)

Options:
  --base <string>   Base ref to compare against
  --title <string>  Title for the session
  --open            Open the review UI in a browser

Global Options:
  --filter-output <keys>              Filter output by key paths (e.g. foo,bar.baz,a[0,3])
  --format <toon|json|yaml|md|jsonl>  Output format
  --full-output                       Show full output envelope
  --help                              Show help
  --llms, --llms-full                 Print LLM-readable manifest
  --schema                            Show JSON Schema for command
  --token-count                       Print token count of output (instead of output)
  --token-limit <n>                   Limit output to n tokens
  --token-offset <n>                  Skip first n tokens of output
```

`agent-diff start --nope` (exit 1, stdout):

```text
$ agent-diff start --nope
code: UNKNOWN
message: "Unknown flag: --nope"
```

`agent-diff hook claude Stopp` (exit 1, stdout):

```text
$ agent-diff hook claude Stopp
code: VALIDATION_ERROR
message: "Invalid option: expected one of \"SessionStart\"|\"UserPromptSubmit\"|\"Stop\"\n\nDetails: [\n  {\n    \"code\": \"invalid_value\",\n    \"values\": [\n      \"SessionStart\",\n      \"UserPromptSubmit\",\n      \"Stop\"\n    ],\n    \"path\": [\n      \"event\"\n    ],\n    \"message\": \"Invalid option: expected one of \\\"SessionStart\\\"|\\\"UserPromptSubmit\\\"|\\\"Stop\\\"\"\n  }\n]"
fieldErrors[1]{code,missing,path,expected,received,message}:
  invalid_value,false,event,"","","Invalid option: expected one of \"SessionStart\"|\"UserPromptSubmit\"|\"Stop\""
```

`agent-diff strat` (exit 1, stdout):

```text
$ agent-diff strat
code: COMMAND_NOT_FOUND
message: 'strat' is not a command for 'agent-diff'. Did you mean 'start'?
cta:
  description: "Suggested commands:"
  commands[2]:
    - command: agent-diff start
    - command: agent-diff --help
      description: see all available commands
```

`agent-diff --llms` (exit 0, stdout):

```text
$ agent-diff --llms
# agent-diff

Review changes made by coding agents.

| Command | Description |
|---------|-------------|
| `agent-diff hook claude <event>` | Handle a Claude Code hook event. |
| `agent-diff review` | Print the most recent review for the current working directory. |
| `agent-diff start <paths...>` | Start a session over one or more working directories. |

Run `agent-diff --llms-full` for full manifest. Run `agent-diff <command> --schema` for argument details.
```

`agent-diff --llms-full` (exit 0, stdout):

```text
$ agent-diff --llms-full
# agent-diff

## agent-diff hook

Handle harness hook events.

### agent-diff hook claude

Handle a Claude Code hook event.

#### Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `event` | `string` | yes | Hook event |

## agent-diff review

### agent-diff review

Print the most recent review for the current working directory.

## agent-diff start

### agent-diff start

Start a session over one or more working directories.

#### Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `paths` | `array` | yes | Working directories to review (default: the current directory) |

#### Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--base` | `string` |  | Base ref to compare against |
| `--title` | `string` |  | Title for the session |
| `--open` | `boolean` | `false` | Open the review UI in a browser |
```

`agent-diff --llms-full --format json` (exit 0, stdout, first 50 lines):

```text
$ agent-diff --llms-full --format json
{
  "version": "incur.v1",
  "commands": [
    {
      "name": "hook claude",
      "description": "Handle a Claude Code hook event.",
      "schema": {
        "args": {
          "type": "object",
          "properties": {
            "event": {
              "type": "string",
              "enum": [
                "SessionStart",
                "UserPromptSubmit",
                "Stop"
              ],
              "description": "Hook event"
            }
          },
          "required": [
            "event"
          ],
          "additionalProperties": false
        }
      }
    },
    {
      "name": "review",
      "description": "Print the most recent review for the current working directory."
    },
    {
      "name": "start",
      "description": "Start a session over one or more working directories.",
      "schema": {
        "args": {
          "type": "object",
          "properties": {
            "paths": {
              "default": [],
              "description": "Working directories to review (default: the current directory)",
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          },
          "required": [
            "paths"
          ],
[… 28 more lines]
```

`agent-diff hook claude --schema` (exit 0, stdout):

```text
$ agent-diff hook claude --schema
args:
  type: object
  properties:
    event:
      type: string
      enum[3]: SessionStart,UserPromptSubmit,Stop
      description: Hook event
  required[1]: event
  additionalProperties: false
```

`agent-diff hook claude Stopp --json` (exit 1, stdout):

```text
$ agent-diff hook claude Stopp --json
{
  "code": "VALIDATION_ERROR",
  "message": "Invalid option: expected one of \"SessionStart\"|\"UserPromptSubmit\"|\"Stop\"\n\nDetails: [\n  {\n    \"code\": \"invalid_value\",\n    \"values\": [\n      \"SessionStart\",\n      \"UserPromptSubmit\",\n      \"Stop\"\n    ],\n    \"path\": [\n      \"event\"\n    ],\n    \"message\": \"Invalid option: expected one of \\\"SessionStart\\\"|\\\"UserPromptSubmit\\\"|\\\"Stop\\\"\"\n  }\n]",
  "fieldErrors": [
    {
      "code": "invalid_value",
      "missing": false,
      "path": "event",
      "expected": "",
      "received": "",
      "message": "Invalid option: expected one of \"SessionStart\"|\"UserPromptSubmit\"|\"Stop\""
    }
  ]
}
```

</details>

#### Clerc

[Source](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/clerc/cli.ts).
28 lines (26 non-blank). `start --help` started in 541 ms, against 238 ms for
`parseArgs` in the same run. Adds `notFoundPlugin`, `strictFlagsPlugin`, and
`friendlyErrorPlugin`.

<details>
<summary>Output</summary>

`agent-diff --help` (exit 0, stdout):

```text
$ agent-diff --help
agent-diff v0.0.0 - Review changes made by coding agents.

Usage
  $ agent-diff <command> [flags]

Global Flags
  --version, -V  Boolean  Prints current version  [default: false]
  --help, -h     Boolean  Show help               [default: false]

Commands
  version      Prints current version
  help         Show help
  start        Start a session over one or more working directories.
  review       Print the most recent review for the current working directory.
  hook claude  Handle a Claude Code hook event.
```

`agent-diff start --help` (exit 0, stdout):

```text
$ agent-diff start --help
agent-diff start v0.0.0 - Start a session over one or more working directories.

Usage
  $ agent-diff start [path...] [flags]

Parameters
  [path...]  Array<string>  Working directories to review (default: the current directory)

Flags
  --base   String   Base ref to compare against
  --title  String   Title for the session
  --open   Boolean  Open the review UI in a browser  [default: false]

Global Flags
  --version, -V  Boolean  Prints current version  [default: false]
  --help, -h     Boolean  Show help               [default: false]
```

`agent-diff start --nope` (exit 1, stderr):

```text
$ agent-diff start --nope
 ERROR  Unexpected flag: nope
```

`agent-diff hook claude Stopp` (exit 1, stderr):

```text
$ agent-diff hook claude Stopp
 ERROR  Invalid value: Stopp. Must be one of: SessionStart, UserPromptSubmit, Stop
```

`agent-diff strat` (exit 1, stderr):

```text
$ agent-diff strat
 ERROR  Command "strat" not found.

 ERROR  Did you mean "start"?
```

</details>

#### Padrone

[Source](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/padrone/cli.ts).
36 lines (34 non-blank). `start --help` started in 807 ms, against 236 ms for
`parseArgs` in the same run. Default settings.

<details>
<summary>Output</summary>

`agent-diff --help` (exit 0, stdout):

```text
$ agent-diff --help
Usage: agent-diff [command]

Review changes made by coding agents.

Commands:
  start              Start a session over one or more working directories.
  review             Print the most recent review for the current working directory.
  hook <subcommand>  Handle harness hook events.

Global: help [command], version, [command] --repl
Run "agent-diff [command] --help" for more information. Use "--all" for all global commands.
```

`agent-diff start --help` (exit 0, stdout):

```text
$ agent-diff start --help
Usage: agent-diff start [paths...] [options]

Start a session over one or more working directories.

Arguments:
  paths...  Working directories to review (default: the current directory)

Options:
  --base   <string>  Base ref to compare against
  --title  <string>  Title for the session
  --open             Open the review UI in a browser (default: false)
```

`agent-diff start --nope` (exit 1, stderr):

```text
$ agent-diff start --nope
Validation error:
  - Unknown option "--nope". Did you mean "--open"?

Run "agent-diff start --help" for usage.
```

`agent-diff hook claude Stopp` (exit 1, stderr):

```text
$ agent-diff hook claude Stopp
Validation error:
  - event: Invalid option: expected one of "SessionStart"|"UserPromptSubmit"|"Stop"

Run "agent-diff hook claude --help" for usage.
```

`agent-diff strat` (exit 1, stderr):

```text
$ agent-diff strat
Unknown command: strat

  Did you mean "start"?

Available commands: start, review, hook

Run "agent-diff --help" for usage.
```

`agent-diff --help --detail full` (exit 0, stdout, first 80 lines):

```text
$ agent-diff --help --detail full
Usage: agent-diff [command]

Review changes made by coding agents.

Commands:
  help (h)           Display help for a command
  version            Display the version number
  repl               Start an interactive REPL
  start              Start a session over one or more working directories.
  review             Print the most recent review for the current working directory.
  hook <subcommand>  Handle harness hook events.

Global: help [command], version, [command] --repl
Run "agent-diff [command] --help" for more information. Use "--all" for all global commands.

Subcommand Details:

────────────────────────────────────────────────────────────
Usage: agent-diff help [command...] [options]

Aliases: h

Display help for a command

Arguments:
  command...  The command to show help for

Options:
  -d, --detail  <string>  How much detail to show
                          (choices: minimal, standard, full)
  -f, --format  <string>  Output format
                          (choices: text, ansi, console, markdown, html, json)
      --all               Show all global commands and options
  -s, --search  <string>  Search commands and help topics

────────────────────────────────────────────────────────────
Usage: agent-diff version [options]

Display the version number

Options:
  --verbose  Also show the runtime, platform and shell
  --check    Also check whether a newer version is available

────────────────────────────────────────────────────────────
Usage: agent-diff repl [scope]

Start an interactive REPL

Arguments:
  scope  Command to scope the REPL to

────────────────────────────────────────────────────────────
Usage: agent-diff start [paths...] [options]

Start a session over one or more working directories.

Arguments:
  paths...  Working directories to review (default: the current directory)

Options:
  --base   <string>  Base ref to compare against
  --title  <string>  Title for the session
  --open             Open the review UI in a browser (default: false)

────────────────────────────────────────────────────────────
Usage: agent-diff review [options]

Print the most recent review for the current working directory.

Options:
  --json  Print JSON (default: false)

────────────────────────────────────────────────────────────
Usage: agent-diff hook [command]

Handle harness hook events.

Commands:
  claude  Handle a Claude Code hook event.
[… 12 more lines]
```

`agent-diff start --help --format json` (exit 0, stdout):

```text
$ agent-diff start --help --format json
{
  "name": "start",
  "description": "Start a session over one or more working directories.",
  "usage": {
    "command": "agent-diff start",
    "hasSubcommands": false,
    "hasPositionals": true,
    "hasArguments": true,
    "helpFlag": "--help"
  },
  "positionals": [
    {
      "name": "...paths",
      "description": "Working directories to review (default: the current directory)",
      "optional": true,
      "default": [],
      "type": "array<string>"
    }
  ],
  "arguments": [
    {
      "name": "base",
      "description": "Base ref to compare against",
      "optional": true,
      "type": "string",
      "variadic": false,
      "negatable": false
    },
    {
      "name": "title",
      "description": "Title for the session",
      "optional": true,
      "type": "string",
      "variadic": false,
      "negatable": false
    },
    {
      "name": "open",
      "description": "Open the review UI in a browser",
      "optional": true,
      "default": false,
      "type": "boolean",
      "variadic": false,
      "negatable": true
    }
  ]
}
```

</details>

#### cli-forge

[Source](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/cliforge/cli.ts).
41 lines (39 non-blank). `start --help` started in 329 ms, against 236 ms for
`parseArgs` in the same run. Turns on `.strict()`. The `llms.txt` below was
generated by
`cli-forge generate-documentation ./cli.ts --export app --format md` with
`markdown-factory` installed alongside, which the example's `package.json`
doesn't include.

<details>
<summary>Output</summary>

`agent-diff --help` (exit 0, stdout):

```text
$ agent-diff --help
Usage: agent-diff
Review changes made by coding agents.

Commands:
  start - Start a session over one or more working directories.
  review - Print the most recent review for the current working directory.
  hook - Handle harness hook events.

Options:
  --help, -h - Show help for the current command
  --version  - Show the version number for the CLI

Run `agent-diff [command] --help` for more information on a command
```

`agent-diff start --help` (exit 0, stdout):

```text
$ agent-diff start --help
Usage: agent-diff start [path]
Start a session over one or more working directories.

Options:
  --help, -h - Show help for the current command
  --version  - Show the version number for the CLI
  --base     - Base ref to compare against
  --title    - Title for the session
  --open     - Open the review UI in a browser
```

`agent-diff start --nope` (exit 1, stdout):

```text
$ agent-diff start --nope
Usage: agent-diff start [path]
Start a session over one or more working directories.

Options:
  --help, -h - Show help for the current command
  --version  - Show the version number for the CLI
  --base     - Base ref to compare against
  --title    - Title for the session
  --open     - Open the review UI in a browser

Validation failed for one or more options
  - Unknown argument: --nope
```

`agent-diff hook claude Stopp` (exit 1, stdout):

```text
$ agent-diff hook claude Stopp
Usage: agent-diff hook claude <event>
Handle a Claude Code hook event.

Options:
  --help, -h - Show help for the current command
  --version  - Show the version number for the CLI

Validation failed for one or more options
  - Invalid value "Stopp" for positional option event. Valid values are: SessionStart, UserPromptSubmit, Stop
```

`agent-diff strat` (exit 1, stdout):

```text
$ agent-diff strat
Usage: agent-diff
Review changes made by coding agents.

Commands:
  start - Start a session over one or more working directories.
  review - Print the most recent review for the current working directory.
  hook - Handle harness hook events.

Options:
  --help, -h - Show help for the current command
  --version  - Show the version number for the CLI

Run `agent-diff [command] --help` for more information on a command

Validation failed for one or more options
  - Unknown argument: strat
```

`cat docs/llms.txt` (exit 0, stdout):

```text
$ cat docs/llms.txt
# agent-diff

Review changes made by coding agents.

This document describes the CLI commands and options for AI agent consumption.

Usage: agent-diff

Options:
  --help (aliases: -h) <boolean>
    Show help for the current command
  --version <boolean>
    Show the version number for the CLI

Subcommands:
  start - Start a session over one or more working directories.
  review - Print the most recent review for the current working directory.
  hook - Handle harness hook events.

  ## agent-diff start
  Start a session over one or more working directories.

  Usage: agent-diff start [path]

  Positional Arguments:
    <path> - string[] (optional)
      Working directories to review (default: the current directory)
      Default: []

  Options:
    --help (aliases: -h) <boolean>
      Show help for the current command
    --version <boolean>
      Show the version number for the CLI
    --base <string>
      Base ref to compare against
    --title <string>
      Title for the session
    --open <boolean>
      Open the review UI in a browser
      Default: false

  ## agent-diff review
  Print the most recent review for the current working directory.

  Usage: agent-diff review

  Options:
    --help (aliases: -h) <boolean>
      Show help for the current command
    --version <boolean>
      Show the version number for the CLI
    --json <boolean>
      Print JSON
      Default: false

  ## agent-diff hook
  Handle harness hook events.

  Usage: agent-diff hook

  Options:
    --help (aliases: -h) <boolean>
      Show help for the current command
    --version <boolean>
      Show the version number for the CLI

  Subcommands:
    claude - Handle a Claude Code hook event.

    ## agent-diff hook claude
    Handle a Claude Code hook event.

    Usage: agent-diff hook claude <event>

    Positional Arguments:
      <event> - string (required)
        Hook event

    Options:
      --help (aliases: -h) <boolean>
        Show help for the current command
      --version <boolean>
        Show the version number for the CLI
```

</details>

#### Crust

[Source](https://raw.githubusercontent.com/danschultz/agent-diff/15df1d4c21be5b5880dc1dc9ad697a1b0a4c8d4b/docs/research/0004-typescript-cli-libraries/crust/cli.ts).
40 lines (34 non-blank). `start --help` started in 374 ms, against 236 ms for
`parseArgs` in the same run. Adds the `help()` and `didYouMean()` extensions
from `@crustjs/extensions`.

<details>
<summary>Output</summary>

`agent-diff --help` (exit 0, stdout):

```text
$ agent-diff --help
agent-diff - Review changes made by coding agents.

Usage:
  agent-diff <command> [options]

Commands:
  start      Start a session over one or more working directories.
  review     Print the most recent review for the current working directory.
  hook       Handle harness hook events.

Options:
  -h, --help                   Show help
```

`agent-diff start --help` (exit 0, stdout):

```text
$ agent-diff start --help
agent-diff start - Start a session over one or more working directories.

Usage:
  agent-diff start [path...] [options]

Arguments:
  [path...]          Working directories to review (default: the current directory)

Options:
  --base                       Base ref to compare against
  --title                      Title for the session
  --open, --no-open            Open the review UI in a browser [default: false]
  -h, --help                   Show help
```

`agent-diff start --nope` (exit 1, stderr):

```text
$ agent-diff start --nope
Error: Unknown flag "--nope"
```

`agent-diff hook claude Stopp` (exit 1, stderr):

```text
$ agent-diff hook claude Stopp
Error: Invalid value "Stopp" for <event>. Expected one of: SessionStart, UserPromptSubmit, Stop
```

`agent-diff strat` (exit 1, stderr):

```text
$ agent-diff strat
Unknown command "strat". Did you mean "start"?

Available commands: start, review, hook
```

</details>

## Options

These are the approaches the findings suggest. They aren't mutually exclusive:
any parser can be paired with a hand-written `help --all` command or a generated
reference.

### Keep `node:util` `parseArgs` with hand-written help

Benefits:

- No dependencies, nothing to install in sandboxes and containers, and the
  fastest startup measured (238 ms, against 187 ms for Node alone).
- Help and errors say exactly what the project writes, so the full reference can
  be one `--help` call.

Costs:

- Help is maintained by hand and can drift from the parser.
- No nested subcommands, allowed values, suggestions, or completion. The example
  needs a cast for the event after a hand-written check, and it's the longest
  example (64 lines).

### A typed parser library

Commander with extra-typings, Stricli, Brocli, citty, gunshi, cmd-ts, Clipanion,
cli-forge, and Crust install 1 to 7 packages in under 4 MB and started within
about 140 ms of the `parseArgs` baseline. Optique, Clerc, and yargs are in the
same family but started 300 ms or more after the baseline (555, 541, and 515
ms), and yargs relies on community types for an older major version.

Benefits:

- Help is generated from the same definitions as the types, per command.
- Commander, Stricli, Crust, Optique, and Clerc print "did you mean"
  suggestions. Stricli gives usage errors distinct exit codes.
- Optique and Clerc build in or bundle completion, and Optique's root help lists
  every command's usage.
- Small enough that installing in sandboxes costs little.

Costs:

- None prints the full reference or machine-readable help from the CLI by
  itself. Stricli and Brocli expose it through an API that a `help --all`
  command would have to print, and cli-forge and Crust generate files at build
  time.
- Each has gaps found here: Brocli has no variadic positionals and its nested
  handler's `event` is `any`; citty accepts unknown options and, like Clipanion,
  writes colour codes to pipes; Clipanion writes errors to stdout and hasn't
  released since 2024; gunshi and cli-forge need strict mode turned on and write
  errors to stdout; gunshi and citty can't check allowed values on a positional;
  Clipanion, cmd-ts, Stricli, and cli-forge don't list allowed values in help.

### A schema-driven, agent-oriented framework

incur and Padrone, and to a lesser degree trpc-cli, define commands with Zod
schemas.

Benefits:

- incur and Padrone print the full reference and JSON help from the CLI itself,
  so an agent can query it without a README.
- incur adds agent features beyond help: structured errors, output formats
  including TOON and JSON, token limits, and skill files.
- The schemas can describe output too (incur), and the same schemas could be
  shared with the review server's API.

Costs:

- 15 to 17 MB installed, mostly Zod, and 658 to 807 ms to start, about three
  times the baseline.
- They bring an MCP server and other features that
  [0011](../decisions/0011-api-core-with-cli-client.md) doesn't plan for. incur
  turns its MCP commands on by default and reserves `--json` and `--format`
  globally.
- They're young: incur's first release was in February 2026, Padrone's in
  December 2025, and Padrone's repository had 1 star.
- incur writes errors to stdout and reports `paths` as required when it has a
  default.

### A full framework

oclif or Effect.

Benefits:

- oclif has plugins for completion and "did you mean", generated README docs, a
  `--json` flag per command, and a test package. It's used by large CLIs and
  released often.
- Effect has built-in completions and "did you mean", and fits a code base that
  uses Effect elsewhere.

Costs:

- oclif installs 38 packages and started in 621 ms. Its types leaked `any` and
  `unknown` into the example, and it needs `package.json` configuration and a
  separate commands module.
- Effect installs 80 MB and took 2.75 s to start, more than 10 times the
  baseline, which matters for frequent calls such as renewing a claim. Its CLI
  module is marked unstable.

## Gaps

Checked by hand:

- Every example was installed in a scratch directory outside the repo,
  type-checked with `tsc --strict --noEmit` (TypeScript 7.0.2) under two module
  settings, probed for `any`, run with Node 24.21.0 type stripping with stdout
  and stderr piped, and benchmarked. None needed a build step.
- The output in this doc was generated from those captured files.
- `NO_COLOR=1` and `TERM=dumb` for Clipanion and citty; incur's `--llms`,
  `--llms-full`, `--format json`, and `--schema`; Padrone's `--detail full` and
  `--format json`; cli-forge's `generate-documentation` with `markdown-factory`
  installed; that cac can't nest commands.

Not checked:

- Output on a real TTY: colour, wrapping, and terminal width. All captures piped
  stdout.
- Installing and using shell completions. Only Effect's and Optique's generated
  scripts were captured.
- The in-process test APIs, global options, oclif's `enableJsonFlag` and
  manifest, Stricli's and gunshi's completion packages, Crust's skills, man
  page, and MCP packages, Padrone's MCP and REST servers, and incur's MCP
  server. These come from docs and types.
- How each library behaves when a hook command must never fail the agent, for
  example reading JSON from stdin and exiting 0 on any error.
- Node 24.20.0, which `.node-version` pins, Bun, macOS, and Windows.
- Startup on other machines. The Atom C3858 is slow, so absolute times will be
  lower elsewhere; the ratios to the baseline are the useful part.
- Effect's startup with narrower imports was measured once, not benchmarked.
- yargs 18 with types written for it, since none exist.
- Maintenance beyond release dates, release counts, stars, and last push. Stars
  and dates were read on 2026-10-13.
- CLI frameworks in other languages, for agent-facing help ideas that no
  TypeScript candidate has. None were surveyed.
