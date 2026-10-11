import type {
  AgentInfo,
  CommentRecord,
  DiffMode,
  FileDiffResponse,
  FileListResponse,
  PlacedComment,
  ReviewInfo,
  ReviewSessionInfo,
  Settings,
  Side,
  SnapshotInfo,
} from '../shared/types.ts';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-agent-diff': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `${method} ${url} failed (${res.status})`);
  return data as T;
}

const q = (params: Record<string, string | number | null | undefined>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '') as [string, string][]).toString();

export interface AppState {
  reviewSessions: ReviewSessionInfo[];
  agents: AgentInfo[];
  settings: Settings;
  cli: string;
}

export const api = {
  state: () => request<AppState>('GET', '/api/state'),
  files: (rs: string, ws: string, mode: DiffMode, snapshot: number | null) =>
    request<FileListResponse>('GET', `/api/review-sessions/${rs}/workspaces/${ws}/files?${q({ mode, snapshot })}`),
  file: (rs: string, ws: string, mode: DiffMode, path: string, oldPath: string | null, snapshot: number | null) =>
    request<FileDiffResponse>('GET', `/api/review-sessions/${rs}/workspaces/${ws}/file?${q({ mode, path, oldPath, snapshot })}`),
  snapshots: (rs: string, ws: string) => request<SnapshotInfo[]>('GET', `/api/review-sessions/${rs}/workspaces/${ws}/snapshots`),
  comments: (rs: string, mode: DiffMode, snapshot: number | null) =>
    request<PlacedComment[]>('GET', `/api/review-sessions/${rs}/comments?${q({ mode, snapshot })}`),
  createComment: (
    rs: string,
    body:
      | { body: string }
      | { workspaceId: string; path: string; side: Side; startLine: number; endLine: number; versionHash: string; mode: DiffMode; body: string },
  ) => request<CommentRecord>('POST', `/api/review-sessions/${rs}/comments`, body),
  updateComment: (id: string, body: string) => request<CommentRecord>('PATCH', `/api/comments/${id}`, { body }),
  deleteComment: (id: string) => request<{ ok: true }>('DELETE', `/api/comments/${id}`),
  reviews: (rs: string) => request<ReviewInfo[]>('GET', `/api/review-sessions/${rs}/reviews`),
  submitReview: (rs: string) => request<ReviewInfo>('POST', `/api/review-sessions/${rs}/reviews`),
  resend: (id: string) => request<{ ok: true }>('POST', `/api/notifications/${id}/resend`),
  endReviewSession: (rs: string) => request<ReviewSessionInfo>('POST', `/api/review-sessions/${rs}/end`),
  updateSettings: (patch: Partial<Settings>) => request<Settings>('POST', '/api/settings', patch),
  metric: (body: Record<string, unknown>) => request<{ ok: true }>('POST', '/api/metrics', body).catch(() => undefined),
};
