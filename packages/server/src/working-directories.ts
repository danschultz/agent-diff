// Turns the paths given to `session new` and `session add` into working
// directories, from decision 0039: each is stored by its real path, with its
// base ref when it uses git.
import { realpath, stat } from 'node:fs/promises';
import type { WorkingDirectory } from '@agent-diff/shared/schemas';
import { defaultBaseRef, resolvesToCommit, usesGit } from './git.ts';

// Why the paths given can't all be added, as one sentence each.
export class WorkingDirectoryError extends Error {}

// The real path of the directory at path, with symlinks resolved, or why it
// can't be a working directory.
async function realDirectory(
  path: string,
): Promise<{ path: string } | { problem: string }> {
  try {
    const real = await realpath(path);
    if (!(await stat(real)).isDirectory()) {
      return { problem: `The working directory ${path} isn't a directory.` };
    }
    return { path: real };
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { problem: `The working directory ${path} doesn't exist.` };
    }
    // Such as EACCES, or ELOOP for a symlink loop, so the path is named
    // rather than reported as an internal error.
    return {
      problem: `The working directory ${path} can't be read (${code ?? String(error)}).`,
    };
  }
}

// Whether a directory is still on disk.
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export interface ResolveOptions {
  // Applies to every working directory that uses git, and must resolve to a
  // commit in each one.
  base?: string | undefined;
  // Real paths already in the session, which keep their base ref, so theirs
  // isn't chosen or checked.
  existing?: ReadonlySet<string>;
  env: NodeJS.ProcessEnv;
}

// Resolves the paths, each to its real path and base ref, once each, in the
// order given. Throws a WorkingDirectoryError naming every path that doesn't
// exist or isn't a directory, or every working directory --base doesn't
// resolve to a commit in.
export async function resolveWorkingDirectories(
  paths: string[],
  { base, existing = new Set(), env }: ResolveOptions,
): Promise<WorkingDirectory[]> {
  const resolved = await Promise.all(paths.map(realDirectory));
  const problems = resolved.flatMap((r) => ('problem' in r ? [r.problem] : []));
  if (problems.length > 0) throw new WorkingDirectoryError(problems.join(' '));

  const realPaths = [
    ...new Set(resolved.map((r) => (r as { path: string }).path)),
  ];
  const workingDirectories = await Promise.all(
    realPaths.map(
      async (path): Promise<WorkingDirectory & { problem?: string }> => {
        if (existing.has(path) || !(await usesGit(path, env))) {
          return { path, baseRef: null };
        }
        if (base === undefined) {
          return { path, baseRef: await defaultBaseRef(path, env) };
        }
        if (!(await resolvesToCommit(path, base, env))) {
          return {
            path,
            baseRef: null,
            problem: `The base ref ${base} doesn't resolve to a commit in ${path}.`,
          };
        }
        return { path, baseRef: base };
      },
    ),
  );
  const baseProblems = workingDirectories.flatMap((w) =>
    w.problem ? [w.problem] : [],
  );
  if (baseProblems.length > 0) {
    throw new WorkingDirectoryError(baseProblems.join(' '));
  }
  return workingDirectories.map(({ path, baseRef }) => ({ path, baseRef }));
}
