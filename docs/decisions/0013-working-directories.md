# 0013: Sessions cover working directories, which don't have to use git

- Status: Accepted, amended by [0018](0018-agents-list-open-comments.md)
- Date: 2026-10-12

> **Amended by [0018](0018-agents-list-open-comments.md):** the CLI doesn't look
> for the working directory that contains the directory it runs in. Commands
> take a session ID, and working directories are given as paths. Claims are
> removed.

## Problem

A session covered a list of workspaces, and each workspace was a repo, the
branch being reviewed, the worktree or directory it was checked out in, and the
base ref it was compared against. That bundle caused trouble:

- Agents and registration also used "workspace" for wherever an agent works,
  outside any session, where there's no branch under review or base ref.
- Agents don't always work in git repos, and a workspace couldn't describe a
  directory that doesn't use git.
- cmux, one of the harnesses, uses "workspace" for its own concept, which may
  confuse agents running inside it.
- Earlier decisions also said "the agent's working directory" for the directory
  a process runs in, which isn't always the directory under review.

## Solution

- **Working directories replace workspaces.** A session covers a list of
  **working directories**. A working directory is a directory on disk. It may be
  a git repo, a git worktree, or a directory inside a repo, or it may not use
  git at all.
- **The working directory is the root.** The diff and the file view only include
  files under the working directory, even when git runs against the whole repo.
  For example, one package in a monorepo can be a working directory.
- **The branch isn't part of a working directory.** In a git working directory,
  the branch is whatever `HEAD` points to.
- **Directories that don't use git have no diffs.** The file view lists all of
  their files, and the diff modes don't apply.
- **A process runs in its current directory.** "Working directory" is used only
  for the term above. The directory a process runs in, such as an agent's or the
  CLI's, is its **current directory**. The CLI finds the working directory that
  contains the current directory.

### Effect on earlier decisions

- **Open in an IDE ([0003](0003-open-in-ide.md)).** "Open worktree" becomes
  "Open working directory." "Open branch" applies only to git working
  directories.
- **Show unchanged files ([0002](0002-show-unchanged-files.md)).** In a working
  directory that doesn't use git, every file is listed, because there are no
  changes to filter by.
- **Sessions and claims ([0009](0009-review-sessions-and-claims.md)).** A
  session covers working directories, and agents claim working directories. The
  branch is no longer part of what's reviewed.
- **Fetching the review ([0010](0010-user-prompts-agent-to-fetch-review.md)).**
  `agent-diff review` finds the working directory that contains the agent's
  current directory, so the agent can run it from a subdirectory.

## Tradeoffs

Benefits:

- One plain idea, a directory, covers git repos, worktrees, parts of a monorepo,
  and directories that don't use git.
- The term no longer clashes with cmux's workspaces.
- An agent can be pointed at a directory without knowing about branches or base
  refs.
- Switching branches in a working directory doesn't make it a different working
  directory, so its session and comments carry on.

Costs:

- Directories that don't use git get no diffs, so the reviewer reads whole files
  to find what changed.
- Git commands run against the whole repo, so the review server has to filter
  their output to the working directory.
- "Working directory" is a common phrase for a process's current directory, so
  docs and CLI output have to keep the two apart.
- A branch switch changes what's shown without the working directory changing,
  which can surprise a reviewer.

## Follow-up design choices

- **Base ref.** Whether the base ref belongs to the working directory, or to the
  working directory's membership in a session.
- **Claim scope.** Whether "at most one active claim" applies per session or to
  the working directory overall.
- **Nested working directories.** Whether one working directory can be inside
  another, and which one the CLI picks for a current directory inside both.
- **Diffs without git.** Whether directories that don't use git later get diffs,
  for example from a baseline snapshot taken when they're added to a session,
  and whether "Last turn" applies to them.
- **Comments without diffs.** How comments are anchored on files in a working
  directory that doesn't use git, since there's no diff side.
- **Identity.** How a working directory is identified when it's moved, deleted,
  or recreated at the same path.
