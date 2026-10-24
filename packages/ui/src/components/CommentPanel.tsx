// The session page's comment panel, from decisions 0036, 0038, and 0043: the
// submitted comments' threads, oldest first, the draft review, and the
// submitted reviews, newest first, each with its review message to copy. On an
// archived session it's read-only: the draft review's comments are shown
// without its controls, and Resolve is hidden.
// It shows what the API returned when the page loaded, and what the reviewer
// changes, with no live updates.
import { useState, type FormEvent } from 'react';
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import {
  commentStatusLabels as statusLabels,
  type Comment,
  type DraftComment,
  type Review,
} from '@agent-diff/shared/schemas';
import { orpc } from '../client.ts';
import { Time } from './Time.tsx';

// Refetches the panel's data after a change, so the change's mutation stays
// pending until the panel shows it.
function useRefresh(sessionId: string): () => Promise<void> {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      queryKey: orpc.review.list.queryKey({ input: { sessionId } }),
    });
}

function ErrorMessage({ error }: { error: Error | null }) {
  return error ? <p role="alert">{error.message}</p> : null;
}

function Thread({
  comment,
  sessionId,
  archived,
}: {
  comment: Comment;
  sessionId: string;
  archived: boolean;
}) {
  const refresh = useRefresh(sessionId);
  const resolve = useMutation(
    orpc.comment.resolve.mutationOptions({ onSuccess: refresh }),
  );
  const header = (
    <>
      <code data-testid="comment-id">{comment.id}</code>{' '}
      <span className="status" data-testid="comment-status">
        {statusLabels[comment.status]}
      </span>
    </>
  );
  const entries = (
    <ol className="thread-entries">
      <li className="text" data-testid="thread-entry">
        Reviewer: <span data-testid="comment-text">{comment.text}</span>
      </li>
      {comment.replies.map((reply, index) => (
        <li key={index} className="text" data-testid="thread-entry">
          Agent, {statusLabels[reply.status]}: {reply.text}
        </li>
      ))}
    </ol>
  );
  if (comment.status === 'resolved') {
    return (
      <li className="thread" data-testid="thread">
        <details>
          <summary className="one-line">
            {header} {comment.text}
          </summary>
          {entries}
        </details>
      </li>
    );
  }
  return (
    <li className="thread" data-testid="thread">
      <div>{header}</div>
      {entries}
      {!archived && (
        <>
          <button
            type="button"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate({ id: comment.id })}
          >
            Resolve
          </button>
          <ErrorMessage error={resolve.error} />
        </>
      )}
    </li>
  );
}

function DraftCommentItem({
  comment,
  sessionId,
}: {
  comment: DraftComment;
  sessionId: string;
}) {
  const refresh = useRefresh(sessionId);
  const [editing, setEditing] = useState<string | null>(null);
  const edit = useMutation(
    orpc.comment.edit.mutationOptions({
      onSuccess: async () => {
        await refresh();
        setEditing(null);
      },
    }),
  );
  const remove = useMutation(
    orpc.comment.delete.mutationOptions({ onSuccess: refresh }),
  );
  if (editing !== null) {
    const save = (event: FormEvent) => {
      event.preventDefault();
      edit.mutate({ id: comment.id, text: editing });
    };
    return (
      <li>
        <form onSubmit={save}>
          <label>
            Edit comment
            <textarea
              value={editing}
              onChange={(event) => setEditing(event.target.value)}
            />
          </label>
          <button type="submit" disabled={edit.isPending}>
            Save
          </button>{' '}
          <button
            type="button"
            onClick={() => {
              edit.reset();
              setEditing(null);
            }}
          >
            Cancel
          </button>
          <ErrorMessage error={edit.error} />
        </form>
      </li>
    );
  }
  return (
    <li>
      <p className="text" data-testid="draft-comment-text">
        {comment.text}
      </p>
      <button type="button" onClick={() => setEditing(comment.text)}>
        Edit
      </button>{' '}
      <button
        type="button"
        disabled={remove.isPending}
        onClick={() => remove.mutate({ id: comment.id })}
      >
        Delete
      </button>
      <ErrorMessage error={remove.error} />
    </li>
  );
}

function DraftReviewSection({
  comments,
  sessionId,
}: {
  comments: DraftComment[];
  sessionId: string;
}) {
  const refresh = useRefresh(sessionId);
  const [text, setText] = useState('');
  const add = useMutation(
    orpc.comment.add.mutationOptions({
      onSuccess: async () => {
        await refresh();
        setText('');
      },
    }),
  );
  const submit = useMutation(
    orpc.review.submit.mutationOptions({ onSuccess: refresh }),
  );
  const addComment = (event: FormEvent) => {
    event.preventDefault();
    add.mutate({ sessionId, text });
  };
  const count = comments.length;
  return (
    <section aria-labelledby="draft-review-heading">
      <h2 id="draft-review-heading">Your draft review</h2>
      {count > 0 && (
        <ul>
          {comments.map((comment) => (
            <DraftCommentItem
              key={comment.id}
              comment={comment}
              sessionId={sessionId}
            />
          ))}
        </ul>
      )}
      <form onSubmit={addComment}>
        <label>
          New comment
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <button type="submit" disabled={add.isPending}>
          Add comment
        </button>
        <ErrorMessage error={add.error} />
      </form>
      <div className="submit-bar">
        <span>
          {count === 0
            ? 'No comments'
            : `${count} ${count === 1 ? 'comment' : 'comments'}`}{' '}
          in your draft review
        </span>
        <button
          type="button"
          disabled={count === 0 || submit.isPending}
          onClick={() => submit.mutate({ sessionId })}
        >
          Submit review
        </button>
      </div>
      <ErrorMessage error={submit.error} />
    </section>
  );
}

// An archived session keeps its draft review, unsubmitted and read-only
// (0043), so its comments are shown without Edit, Delete, or Submit.
function ArchivedDraftReviewSection({
  comments,
}: {
  comments: DraftComment[];
}) {
  return (
    <section aria-labelledby="draft-review-heading">
      <h2 id="draft-review-heading">Your draft review</h2>
      <p>These comments were never submitted.</p>
      <ul>
        {comments.map((comment) => (
          <li key={comment.id}>
            <p className="text" data-testid="draft-comment-text">
              {comment.text}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReviewItem({ review }: { review: Review }) {
  const [copied, setCopied] = useState(false);
  const copy = useMutation({
    mutationFn: () => navigator.clipboard.writeText(review.message),
    onSuccess: () => setCopied(true),
  });
  return (
    <li>
      <div>
        Review <code data-testid="review-id">{review.id}</code>, submitted{' '}
        <Time value={review.submittedAt} />
      </div>
      <p className="review-message" data-testid="review-message">
        {review.message}
      </p>
      <button type="button" onClick={() => copy.mutate()}>
        {copied ? 'Copied' : 'Copy review message'}
      </button>
      <ErrorMessage error={copy.error} />
    </li>
  );
}

export function CommentPanel({
  sessionId,
  archived,
}: {
  sessionId: string;
  archived: boolean;
}) {
  const { data } = useSuspenseQuery(
    orpc.review.list.queryOptions({ input: { sessionId } }),
  );
  return (
    <aside aria-label="Comments" className="comment-panel">
      {archived && (
        <p>This session is archived, so its comments are read-only.</p>
      )}
      <section aria-labelledby="threads-heading">
        <h2 id="threads-heading">Threads</h2>
        {data.comments.length === 0 ? (
          <p>No comments have been submitted.</p>
        ) : (
          <ol className="threads">
            {data.comments.map((comment) => (
              <Thread
                key={comment.id}
                comment={comment}
                sessionId={sessionId}
                archived={archived}
              />
            ))}
          </ol>
        )}
      </section>
      {!archived ? (
        <DraftReviewSection
          comments={data.draftReview.comments}
          sessionId={sessionId}
        />
      ) : (
        data.draftReview.comments.length > 0 && (
          <ArchivedDraftReviewSection comments={data.draftReview.comments} />
        )
      )}
      <section aria-labelledby="reviews-heading">
        <h2 id="reviews-heading">Reviews</h2>
        {data.reviews.length === 0 ? (
          <p>No reviews have been submitted.</p>
        ) : (
          <ol className="reviews">
            {data.reviews.map((review) => (
              <ReviewItem key={review.id} review={review} />
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}
