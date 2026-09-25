export class VideoProjectStorageError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}
export interface VideoProjectCommitOptions {
  /** Exact bytes read; null means the file must not exist. */
  expectedContent: string | null;
  /** False only when recovering the existing last-good backup. */
  backupExisting?: boolean;
}
export function commitVideoProjectContent(path: string, content: string, options: VideoProjectCommitOptions): void;
