// GitHub access through the `gh` CLI.

import { run } from './exec.ts';

export interface Issue {
  number: number;
  title: string;
  body: string;
  url: string;
  author: string;
  labels: string[];
  state: 'OPEN' | 'CLOSED';
}

export interface Review {
  id: string;
  author: string;
  state: string;
  body: string;
  submittedAt: string;
}

export interface PullRequest {
  number: number;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  reviews: Review[];
}

export interface GitHub {
  queuedIssues(label: string): Issue[];
  issue(number: number): Issue;
  /** The most recent pull request whose head is `branch`, in any state. */
  pullRequestForBranch(branch: string): PullRequest | undefined;
  setLabels(issue: number, add: string[], remove: string[]): void;
  comment(issue: number, body: string): void;
}

const ISSUE_FIELDS = 'number,title,body,url,author,labels,state';

interface RawIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  author: { login: string };
  labels: { name: string }[];
  state: 'OPEN' | 'CLOSED';
}

function toIssue(raw: RawIssue): Issue {
  return { ...raw, author: raw.author.login, labels: raw.labels.map((l) => l.name) };
}

export function ghGitHub(repo: string): GitHub {
  const gh = (args: string[], input?: string) => run('gh', [...args, '-R', repo], { input });
  return {
    queuedIssues(label) {
      const raw = JSON.parse(gh(['issue', 'list', '--state', 'open', '--label', label, '--limit', '100', '--json', ISSUE_FIELDS])) as RawIssue[];
      return raw.map(toIssue).sort((a, b) => a.number - b.number);
    },
    issue(number) {
      return toIssue(JSON.parse(gh(['issue', 'view', String(number), '--json', ISSUE_FIELDS])) as RawIssue);
    },
    pullRequestForBranch(branch) {
      const raw = JSON.parse(
        gh(['pr', 'list', '--state', 'all', '--head', branch, '--limit', '1', '--json', 'number,url,state,reviews']),
      ) as { number: number; url: string; state: PullRequest['state']; reviews: (Omit<Review, 'author'> & { author: { login: string } })[] }[];
      const pr = raw[0];
      if (!pr) return undefined;
      return { ...pr, reviews: pr.reviews.map((r) => ({ ...r, author: r.author.login })) };
    },
    setLabels(issue, add, remove) {
      if (add.length === 0 && remove.length === 0) return;
      const args = ['issue', 'edit', String(issue)];
      for (const label of add) args.push('--add-label', label);
      for (const label of remove) args.push('--remove-label', label);
      gh(args);
    },
    comment(issue, body) {
      gh(['issue', 'comment', String(issue), '--body-file', '-'], body);
    },
  };
}

/** Moves an issue to `label`, dropping whichever other agent:* labels it has. */
export function moveTo(github: GitHub, issue: Issue | { number: number; labels: string[] }, label: string, all: readonly string[]): void {
  const remove = issue.labels.filter((l) => l !== label && all.includes(l));
  const add = issue.labels.includes(label) ? [] : [label];
  github.setLabels(issue.number, add, remove);
  issue.labels = [...issue.labels.filter((l) => !remove.includes(l)), ...add];
}
