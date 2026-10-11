import { useState } from 'react';
import type { AgentInfo, PlacedComment, ReviewInfo, WorkspaceInfo } from '../shared/types.ts';
import { stateLabel } from './viewers/types.ts';

interface Props {
  comments: PlacedComment[];
  reviews: ReviewInfo[];
  agents: AgentInfo[];
  workspaces: WorkspaceInfo[];
  canComment: boolean;
  onCreateOverall: (body: string) => Promise<void>;
  onUpdate: (id: string, body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSubmit: () => Promise<void>;
  onResend: (notificationId: string) => Promise<void>;
  onJump: (comment: PlacedComment) => void;
}

export function CommentsPanel(props: Props) {
  const { comments, reviews, agents, workspaces, canComment } = props;
  const drafts = comments.filter((c) => !c.reviewId);
  const [overallBody, setOverallBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const agentLabel = (id: string | null) => (id ? (agents.find((a) => a.id === id)?.label ?? id) : 'No agent registered');
  const wsLabel = (id: string | null) => workspaces.find((w) => w.id === id)?.root.split('/').pop() ?? id ?? '';

  return (
    <div className="comments-panel">
      {error && <div className="error">{error}</div>}

      <section>
        <h3>Comments</h3>
        <p className="hint">Hover a line number and click its +, or drag the + across line numbers, to comment on lines.</p>
        <div className="composer overall">
          <textarea value={overallBody} placeholder="Overall comment on the review" onChange={(e) => setOverallBody(e.target.value)} />
          <button
            disabled={busy || !canComment || !overallBody.trim()}
            onClick={() =>
              act(async () => {
                await props.onCreateOverall(overallBody);
                setOverallBody('');
              })
            }
          >
            Add overall comment
          </button>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h3>Drafts ({drafts.length})</h3>
          <button className="primary" disabled={busy || drafts.length === 0} onClick={() => act(props.onSubmit)}>
            Submit review
          </button>
        </div>
        {drafts.length === 0 && <p className="hint">Comments stay drafts until you submit them as a review.</p>}
        {drafts.map((c) => (
          <CommentItem key={c.id} comment={c} wsLabel={wsLabel(c.workspaceId)} onJump={props.onJump} onUpdate={props.onUpdate} onDelete={props.onDelete} />
        ))}
      </section>

      <section>
        <h3>Submitted reviews ({reviews.length})</h3>
        {[...reviews].reverse().map((r) => (
          <div key={r.id} className="review">
            <div className="review-head">
              {r.id} · {new Date(r.submittedAt).toLocaleTimeString()} · {r.commentCount} comment{r.commentCount === 1 ? '' : 's'}
            </div>
            {r.notifications.map((n) => (
              <div key={n.id} className="notification">
                <span className={`badge n-${n.status}`}>{n.status}</span>
                <span className="notification-target">
                  {agentLabel(n.agentId)} via {n.method.length > 40 ? n.method.slice(0, 40) + '…' : n.method} ({wsLabel(n.workspaceId)})
                </span>
                {n.error && <div className="notification-error">{n.error}</div>}
                {(n.status === 'manual' || n.status === 'pull' || n.status === 'failed') && (
                  <div className="paste">
                    {n.status === 'pull'
                      ? "The agent's hooks deliver this when its current turn ends. If it's idle, paste this to it:"
                      : 'Paste this to the agent:'}
                    <code>{n.message}</code>
                    <button onClick={() => navigator.clipboard.writeText(n.message)}>Copy</button>
                  </div>
                )}
                {n.status === 'failed' && <button onClick={() => act(() => props.onResend(n.id))}>Resend</button>}
              </div>
            ))}
            {r.fetches.length > 0 && (
              <div className="fetches">
                Fetched by{' '}
                {r.fetches
                  .map((f) => `${f.agentId ? agentLabel(f.agentId) : 'an unregistered agent'} (${wsLabel(f.workspaceId)}) at ${new Date(f.fetchedAt).toLocaleTimeString()}`)
                  .join(', ')}
              </div>
            )}
            {comments
              .filter((c) => c.reviewId === r.id)
              .map((c) => (
                <CommentItem key={c.id} comment={c} wsLabel={wsLabel(c.workspaceId)} onJump={props.onJump} />
              ))}
          </div>
        ))}
      </section>

      <section>
        <h3>Agents ({agents.length})</h3>
        {agents.length === 0 && <p className="hint">No agents registered. Feedback can still be pasted by hand.</p>}
        {agents.map((a) => (
          <div key={a.id} className="agent">
            <span className={`dot ${a.busy ? 'busy' : 'idle'}`} />
            <span className="agent-label">{a.label ?? a.id}</span>
            <span className="agent-meta">
              {a.busy ? 'mid-turn' : 'idle'} · {a.notify}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}

function CommentItem({
  comment,
  wsLabel,
  onJump,
  onUpdate,
  onDelete,
}: {
  comment: PlacedComment;
  wsLabel: string;
  onJump: (c: PlacedComment) => void;
  onUpdate?: (id: string, body: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  const p = comment.placement;
  const at = p?.range ?? p?.replacement;
  const draftChanged = !comment.reviewId && p && p.state !== 'current';
  return (
    <div className={`comment-item state-${p?.state ?? 'overall'}`}>
      <div className="comment-item-head" onClick={() => comment.path && onJump(comment)}>
        {comment.path ? (
          <>
            <span className="loc">
              {wsLabel} · {p?.path ?? comment.path}:{at ? lineLabel(at.start, at.end, true) : `${lineLabel(comment.startLine!, comment.endLine!, true)} (gone)`}
            </span>
            {p && (
              <span className={`badge s-${p.state}`} title={p.reason}>
                {stateLabel(p.state)}
              </span>
            )}
          </>
        ) : (
          <span className="loc">Overall comment</span>
        )}
      </div>
      {draftChanged && <div className="warning">The code you commented on changed. Check that this comment still applies. {p!.reason}</div>}
      {editing ? (
        <>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="row-actions">
            <button
              className="primary"
              onClick={async () => {
                await onUpdate!(comment.id, body);
                setEditing(false);
              }}
            >
              Save
            </button>
            <button onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </>
      ) : (
        <div className="comment-item-body">{comment.body}</div>
      )}
      {!comment.reviewId && !editing && onUpdate && (
        <div className="row-actions">
          <button onClick={() => setEditing(true)}>Edit</button>
          <button onClick={() => onDelete!(comment.id)}>Delete</button>
        </div>
      )}
    </div>
  );
}

export function lineLabel(start: number, end: number, short = false): string {
  if (short) return start === end ? `${start}` : `${start}-${end}`;
  return start === end ? `line ${start}` : `lines ${start}-${end}`;
}
