import type { Request } from 'express';

/**
 * Query-string values as the route handlers read them. Express can deliver
 * arrays/objects for repeated or bracketed keys, but these handlers only ever
 * treat them as plain strings (String()/parseInt()/template literals).
 * NOTE: a key that wasn't sent is `undefined` at runtime; every handler already
 * guards with `|| default` / truthiness checks, so the type stays `string` to
 * match how the values are consumed (parseInt(), .split(), etc.).
 */
export type QueryStrings = Record<string, string>;

/** Request whose req.query is read as plain strings, with an optional typed body. */
export type QueryRequest<B = unknown> = Request<Record<string, string>, unknown, B, QueryStrings>;
