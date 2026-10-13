import { stateLabel, type CommentMark } from './types.ts';

export function CommentCards({ marks }: { marks: CommentMark[] }) {
  if (marks.length === 0) return null;
  return (
    <div className="inline-comments">
      {marks.map((mark) => (
        <div
          key={mark.comment.id}
          data-comment-id={mark.comment.id}
          className={`comment-card state-${mark.state}${mark.comment.reviewId ? '' : ' draft'}`}
        >
          <div
            className="comment-card-head"
            title={mark.comment.placement?.reason}
          >
            {mark.comment.reviewId ? 'Submitted' : 'Draft'} ·{' '}
            {stateLabel(mark.state)}
            {mark.lines ? '' : ' · lines removed'}
          </div>
          {mark.state === 'outdated' &&
            mark.comment.originalCode.length > 0 && (
              <pre className="comment-card-original">
                {mark.comment.originalCode.join('\n')}
              </pre>
            )}
          <div className="comment-card-body">{mark.comment.body}</div>
        </div>
      ))}
    </div>
  );
}
