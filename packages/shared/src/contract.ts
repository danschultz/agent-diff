// The review server's API, declared contract-first. The review server
// implements it with `implement()` and serves it with `RPCHandler`, and the
// CLI and the review UI call it through `RPCLink`, typed as
// `ContractRouterClient<typeof contract>`. See decision 0025.
import { oc } from '@orpc/contract';
import * as v from 'valibot';
import {
  AddWorkingDirectoriesInput,
  AddWorkingDirectoriesOutput,
  ArchiveSessionOutput,
  Health,
  ListSessionsInput,
  NewSessionInput,
  Session,
  SessionDetails,
  SessionRef,
} from './schemas.ts';

export const contract = {
  // `server start` calls this on the saved port to tell whether the review
  // server is already running.
  health: oc.output(Health),
  // Named after the `agent-diff session` commands. A session ID that's
  // malformed or names no session fails with NOT_FOUND.
  session: {
    new: oc.input(NewSessionInput).output(Session),
    // Fails with CONFLICT when the session is archived.
    add: oc
      .input(AddWorkingDirectoriesInput)
      .output(AddWorkingDirectoriesOutput),
    show: oc.input(SessionRef).output(SessionDetails),
    // Newest first.
    list: oc.input(ListSessionsInput).output(v.array(Session)),
    archive: oc.input(SessionRef).output(ArchiveSessionOutput),
    delete: oc.input(SessionRef).output(v.void()),
  },
};

export type Contract = typeof contract;

// The path the API is served under. Everything else is the review UI.
export const apiPrefix = '/api';
