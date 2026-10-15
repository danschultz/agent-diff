export type CreateReviewSession = {
  workingDirectories: string[];
  title?: string | undefined;
};
export type AddComment = {
  path: string;
  startLine: number;
  endLine: number;
  body: string;
};
export type Comment = AddComment & {
  id: string;
  reviewSessionId: string;
  createdAt: string;
};
export type ReviewSession = {
  id: string;
  title: string | null;
  workingDirectories: string[];
  startedAt: string;
  comments: Comment[];
};
