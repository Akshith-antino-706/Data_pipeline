// Minimal ambient typings for `pg-copy-streams` (no @types installed).
// Covers only what services/JourneyArchiveService uses: COPY … TO STDOUT as a readable stream.
declare module 'pg-copy-streams' {
  import type { Readable } from 'node:stream';
  import type { Submittable } from 'pg';

  interface CopyToStreamQuery extends Readable, Submittable {
    /** Rows copied so far; final once the stream has ended. */
    rowCount: number;
  }
  export function to(text: string): CopyToStreamQuery;
}
