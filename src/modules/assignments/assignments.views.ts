import { AttachmentView } from '../storage/storage.types';
import { UserPublic } from '../users/users.views';

export type AssignmentState = 'NOT_STARTED' | 'OPEN' | 'CLOSED';

export interface SubmissionView {
  id: string;
  assignmentId: string;
  submitter: UserPublic;
  note: string | null;
  attachment: AttachmentView;
  createdAt: string;
  updatedAt: string;
}

export interface AssignmentItem {
  id: string;
  slug: string;
  title: string;
  description: string;
  startAt: string;
  deadlineAt: string;
  state: AssignmentState;
  canSubmit: boolean;
  publisher: UserPublic;
  mySubmission: SubmissionView | null;
  createdAt: string;
  updatedAt: string;
}

export interface MySubmissionItem {
  id: string;
  assignmentId: string;
  assignmentSlug: string;
  assignmentTitle: string;
  startAt: string;
  deadlineAt: string;
  state: AssignmentState;
  note: string | null;
  attachment: { id: string; fileName: string } | null;
  createdAt: string;
  updatedAt: string;
}
