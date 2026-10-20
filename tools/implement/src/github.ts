// Pull requests on GitHub, through the `gh` CLI. Briefs live in Aven, so
// `implement` never reads or writes GitHub issues.

import { run } from './exec.ts';

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
  /** The most recent pull request whose head is `branch`, in any state. */
  pullRequestForBranch(branch: string): PullRequest | undefined;
}

export function ghGitHub(repo: string): GitHub {
  const gh = (args: string[]) => run('gh', [...args, '-R', repo]);
  return {
    pullRequestForBranch(branch) {
      const raw = JSON.parse(
        gh([
          'pr',
          'list',
          '--state',
          'all',
          '--head',
          branch,
          '--limit',
          '1',
          '--json',
          'number,url,state,reviews',
        ]),
      ) as {
        number: number;
        url: string;
        state: PullRequest['state'];
        reviews: (Omit<Review, 'author'> & { author: { login: string } })[];
      }[];
      const pr = raw[0];
      if (!pr) return undefined;
      return {
        ...pr,
        reviews: pr.reviews.map((r) => ({ ...r, author: r.author.login })),
      };
    },
  };
}
