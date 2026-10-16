// Minimal ambient typings for the `archiver` package (no @types/archiver installed).
// Covers only what routes/dailyReport uses.
declare module 'archiver' {
  import type { Readable, Writable } from 'node:stream';

  interface ArchiverOptions {
    zlib?: { level?: number };
  }
  interface EntryData {
    name: string;
  }
  interface Archiver extends Readable {
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    pipe<T extends Writable>(destination: T): T;
    append(source: string | Buffer | Readable, data: EntryData): this;
    finalize(): Promise<void>;
  }
  function archiver(format: 'zip' | 'tar', options?: ArchiverOptions): Archiver;
  export default archiver;
}
