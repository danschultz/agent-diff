// Configures `npm run lint:docs`, which checks local links in every Markdown
// file. See the Checks section of AGENTS.md.
import remarkValidateLinks from 'remark-validate-links';
import remarkLocalLinks from './scripts/remark-local-links.ts';

export default {
  plugins: [
    // Naming the repository means the check doesn't need an `origin` remote,
    // and follows GitHub's rules for heading anchors and absolute paths.
    [remarkValidateLinks, { repository: 'danschultz/agent-diff' }],
    remarkLocalLinks,
  ],
};
