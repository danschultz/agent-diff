// Types shared by the review server, the CLI, and the review UI.

import type { AnchorState, LineRange, ReanchorOptions } from './reanchor.ts';

export type DiffMode = 'all' | 'committed' | 'staged' | 'unstaged' | 'last-turn';

export const DIFF_MODES: { mode: DiffMode; label: string; compares: string }[] = [
  { mode: 'all', label: 'All changes', compares: 'Base ref to the working tree' },
  { mode: 'committed', label: 'Committed', compares: 'Base ref to HEAD' },
  { mode: 'staged', label: 'Staged', compares: 'HEAD to the index' },
  { mode: 'unstaged', label: 'Unstaged', compares: 'The index to the working tree' },
  { mode: 'last-turn', label: 'Last turn', compares: 'A turn snapshot to the working tree' },
];

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type-changed' | 'untracked';

export type Side = 'old' | 'new';

export interface TreeSideInfo {
  kind: 'base' | 'head' | 'index' | 'worktree' | 'snapshot';
  label: string;
  tree: string;
}

export interface ChangedFile {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  added: number | null;
  removed: number | null;
  binary: boolean;
  commentCount: number;
}

export interface FileListResponse {
  from: TreeSideInfo;
  to: TreeSideInfo;
  files: ChangedFile[];
  timingMs: { trees: number; diff: number; total: number };
  warning: string | null;
}

export interface FileSideContent {
  /** Git blob hash. Also the key of the stored file version. */
  hash: string | null;
  content: string | null;
  binary: boolean;
  tooLarge: boolean;
}

export interface FileDiffResponse {
  path: string;
  oldPath: string | null;
  status: FileStatus | 'unchanged';
  old: FileSideContent;
  new: FileSideContent;
  comments: PlacedComment[];
  timingMs: { git: number; reanchor: number; total: number };
}

export interface Placement {
  state: AnchorState;
  range: LineRange | null;
  replacement: LineRange | null;
  insertAfter: number | null;
  similarity: number | null;
  reason: string;
  /** The path the comment is shown on, which differs from its anchor after a rename. */
  path: string | null;
}

export interface CommentRecord {
  id: string;
  reviewSessionId: string;
  /** Null while the comment is a draft. */
  reviewId: string | null;
  /** Null for overall comments. */
  workspaceId: string | null;
  path: string | null;
  side: Side | null;
  startLine: number | null;
  endLine: number | null;
  fileVersion: string | null;
  diffMode: DiffMode | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlacedComment extends CommentRecord {
  placement: Placement | null;
  /** The lines the comment was written on, from its file version. */
  originalCode: string[];
}

export interface WorkspaceInfo {
  id: string;
  root: string;
  baseRef: string;
  branch: string | null;
}

export interface ReviewSessionInfo {
  id: string;
  title: string | null;
  status: 'open' | 'ended';
  startedBy: string | null;
  createdAt: string;
  endedAt: string | null;
  workspaces: WorkspaceInfo[];
}

export interface AgentInfo {
  id: string;
  label: string | null;
  parentId: string | null;
  notify: string;
  busy: boolean;
  lastSeenAt: string;
  workspaceIds: string[];
}

export type NotificationStatus = 'held' | 'sent' | 'failed' | 'pull' | 'manual' | 'fetched';

export interface NotificationInfo {
  id: string;
  reviewId: string;
  agentId: string | null;
  workspaceId: string;
  method: string;
  message: string;
  status: NotificationStatus;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  fetchedAt: string | null;
}

export interface ReviewInfo {
  id: string;
  reviewSessionId: string;
  submittedAt: string;
  commentCount: number;
  notifications: NotificationInfo[];
  fetches: { workspaceId: string; agentId: string | null; fetchedAt: string }[];
}

export interface SnapshotInfo {
  id: number;
  workspaceId: string;
  seq: number;
  commit: string;
  ref: string;
  agentId: string | null;
  reason: string;
  createdAt: string;
}

export interface Settings {
  /** Wait this long after the last file event before refreshing. */
  debounceMs: number;
  /** Refresh at least this often during a continuous burst of events. */
  maxWaitMs: number;
  /** Hold notifications while the agent is mid-turn, and send them when the turn ends. */
  holdWhileBusy: boolean;
  /** Pause between typing a notification and pressing Enter in a terminal. */
  enterDelayMs: number;
  reanchor: ReanchorOptions;
}

export interface WorkspaceChangedEvent {
  type: 'workspace-changed';
  workspaceId: string;
  paths: string[];
  pathCount: number;
  rawEventCount: number;
  ignoredCount: number;
  gitMetadata: boolean;
  firstEventAt: number;
  flushedAt: number;
}

export type ServerEvent =
  | WorkspaceChangedEvent
  | { type: 'comments-changed'; reviewSessionId: string }
  | { type: 'reviews-changed'; reviewSessionId: string }
  | { type: 'state-changed' }
  | { type: 'snapshot-created'; workspaceId: string; snapshot: SnapshotInfo };

export interface FeedbackComment {
  id: string;
  reviewId: string;
  kind: 'line' | 'overall';
  path: string | null;
  side: Side | null;
  original: { startLine: number; endLine: number; code: string[] } | null;
  current: { state: AnchorState; startLine: number | null; endLine: number | null; code: string[]; reason: string } | null;
  body: string;
}

export interface FeedbackResponse {
  reviewSessionId: string;
  workspace: { id: string; root: string; baseRef: string } | null;
  reviews: { id: string; submittedAt: string }[];
  comments: FeedbackComment[];
}

export interface PendingFeedback {
  pending: boolean;
  reviewSessionId: string | null;
  reviewIds: string[];
  commentCount: number;
  message: string | null;
}
