// A remark plugin for the link checks remark-validate-links doesn't do. It
// fails a local link or image that:
//
// - Is a `file:` URL.
// - Is an absolute path, such as `/docs/glossary.md`.
// - Is a relative path that resolves outside the repo root.
// - Points to a file or folder that git ignores.
// - Is in a skill, under `.claude/skills/`, and points into `.rules/`. Rules
//   can point to skills, but skills hold their own process and don't point
//   back. See decision 0039.
//
// Links with any other URL scheme, and links that are only `#anchor`, are left
// to remark-validate-links or not checked. The repo root is the working
// directory remark runs in, which `npm run lint:docs` sets to the top of the
// working tree. See the Checks section of AGENTS.md.

import { execFile } from 'node:child_process';
import path from 'node:path';
import type { Root } from 'mdast';
import { visit } from 'unist-util-visit';
import type { VFile } from 'vfile';

const source = 'remark-local-links';
const scheme = /^[a-z][a-z0-9+.-]*:/i;
const skills = path.join('.claude', 'skills') + path.sep;
const rules = '.rules';

type Resource = { url: string; position?: Root['position'] };

type Target = { file: VFile; node: Resource; relative: string };

type FileSet = {
  use(completer: (set: FileSet) => Promise<void>): void;
  valueOf(): VFile[];
};

const targetsKey = 'remarkLocalLinksTargets';

export default function remarkLocalLinks(
  _options?: unknown,
  fileSet?: FileSet,
) {
  // The CLI parses every file before running completers, so one `git` call
  // can check the targets of every file.
  if (fileSet) {
    fileSet.use(checkIgnoredInSet);
  }

  return async function (tree: Root, file: VFile) {
    const root = file.cwd;
    const base = file.path
      ? path.dirname(path.resolve(file.cwd, file.path))
      : root;
    const inSkill = file.path
      ? path
          .relative(root, path.resolve(file.cwd, file.path))
          .startsWith(skills)
      : false;
    const targets: Target[] = [];

    visit(tree, function (node) {
      if (!('url' in node) || !node.url) {
        return;
      }
      const reason = check(node.url, base, root, inSkill);
      if (typeof reason === 'string') {
        warn(file, node, reason);
      } else if (reason) {
        targets.push({ file, node, relative: reason.relative });
      }
    });

    if (fileSet) {
      file.data[targetsKey] = targets;
    } else {
      await checkIgnored(root, targets);
    }
  };
}

// Returns why a link fails, the target to check against gitignore, or
// undefined when the link isn't checked.
function check(
  url: string,
  base: string,
  root: string,
  inSkill: boolean,
): string | { relative: string } | undefined {
  if (/^file:/i.test(url)) {
    return 'Link `' + url + '` is a `file:` URL; link to a file in the repo';
  }
  if (scheme.test(url) || url.startsWith('#')) {
    return undefined;
  }
  if (url.startsWith('/')) {
    return (
      'Link `' + url + '` is an absolute path; use a path relative to this file'
    );
  }

  let pathname = url.replace(/[?#].*$/s, '');
  if (!pathname) {
    return undefined;
  }
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Keep the encoded path, so remark-validate-links reports it as missing.
  }

  const relative = path.relative(root, path.resolve(base, pathname));
  if (relative === '..' || relative.startsWith('..' + path.sep)) {
    return 'Link `' + url + '` points outside the repo';
  }
  if (!relative) {
    return undefined;
  }
  if (
    inSkill &&
    (relative === rules || relative.startsWith(rules + path.sep))
  ) {
    return (
      'Link `' +
      url +
      "` points to a rule in `.rules/`; skills don't link to rules"
    );
  }
  return { relative };
}

async function checkIgnoredInSet(set: FileSet) {
  const byRoot = new Map<string, Target[]>();
  for (const file of set.valueOf()) {
    const targets = file.data[targetsKey] as Target[] | undefined;
    if (!targets?.length) {
      continue;
    }
    const list = byRoot.get(file.cwd) ?? [];
    list.push(...targets);
    byRoot.set(file.cwd, list);
  }
  for (const [root, targets] of byRoot) {
    await checkIgnored(root, targets);
  }
}

async function checkIgnored(root: string, targets: Target[]) {
  if (targets.length === 0) {
    return;
  }
  const paths = [...new Set(targets.map((target) => target.relative))];
  const ignored = new Set(await gitCheckIgnore(root, paths));
  for (const target of targets) {
    if (ignored.has(target.relative)) {
      warn(
        target.file,
        target.node,
        'Link `' +
          target.node.url +
          '` points to `' +
          target.relative +
          '`, which git ignores',
      );
    }
  }
}

// Lists the paths git ignores. Tracked files are never ignored.
function gitCheckIgnore(root: string, paths: string[]): Promise<string[]> {
  return new Promise(function (resolve, reject) {
    const child = execFile(
      'git',
      ['check-ignore', '--stdin', '-z'],
      { cwd: root, encoding: 'utf8' },
      function (error, stdout) {
        // Exit code 1 means none of the paths are ignored.
        if (error && error.code !== 1) {
          reject(error);
          return;
        }
        resolve(stdout.split('\0').filter(Boolean));
      },
    );
    child.stdin?.end(paths.join('\0') + '\0');
  });
}

function warn(file: VFile, node: Resource, reason: string) {
  file.message(reason, {
    place: node.position,
    source,
    ruleId: 'local-link',
  });
}
