import { lazy, type ComponentType } from 'react';
import type { ViewerProps } from './types.ts';

export type ViewerId = 'basic' | 'git-diff-view' | 'monaco' | 'codemirror';

export const VIEWERS: {
  id: ViewerId;
  label: string;
  notes: string;
  component: ComponentType<ViewerProps>;
}[] = [
  {
    id: 'basic',
    label: 'Basic (custom)',
    notes: 'jsdiff and a table. No syntax highlighting.',
    component: lazy(() => import('./BasicViewer.tsx')),
  },
  {
    id: 'git-diff-view',
    label: '@git-diff-view/react',
    notes: 'GitHub-style rows with highlighting. Comments use extension rows.',
    component: lazy(() => import('./GitDiffViewViewer.tsx')),
  },
  {
    id: 'monaco',
    label: 'Monaco diff editor',
    notes:
      "The VS Code editor. Tall files scroll inside the editor. In unified layout, removed lines can't be commented on.",
    component: lazy(() => import('./MonacoViewer.tsx')),
  },
  {
    id: 'codemirror',
    label: 'CodeMirror merge',
    notes:
      "CodeMirror 6 merge view. In unified layout, removed lines can't be commented on.",
    component: lazy(() => import('./CodeMirrorViewer.tsx')),
  },
];
