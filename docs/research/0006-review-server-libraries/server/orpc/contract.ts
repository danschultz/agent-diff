// The API contract, imported by the server and by clients such as the CLI.
import { eventIterator, oc } from '@orpc/contract';
import * as z from 'zod';
import {
  AddComment,
  Comment,
  CreateReviewSession,
  ReviewSession,
} from './shared/schemas.ts';

const NOT_FOUND = { message: 'Review session not found' };
const byId = z.object({ id: z.string() });

export const contract = {
  health: oc
    .route({ method: 'GET', path: '/health' })
    .output(z.object({ ok: z.boolean() })),
  events: oc
    .route({ method: 'GET', path: '/events' })
    .output(eventIterator(Comment)),
  reviewSessions: {
    create: oc
      .route({ method: 'POST', path: '/review-sessions', successStatus: 201 })
      .input(CreateReviewSession)
      .output(ReviewSession),
    get: oc
      .route({ method: 'GET', path: '/review-sessions/{id}' })
      .errors({ NOT_FOUND })
      .input(byId)
      .output(ReviewSession),
    addComment: oc
      .route({
        method: 'POST',
        path: '/review-sessions/{id}/comments',
        successStatus: 201,
        inputStructure: 'detailed',
      })
      .errors({ NOT_FOUND })
      .input(z.object({ params: byId, body: AddComment }))
      .output(Comment),
  },
};
