import { z } from '@hono/zod-openapi';

// ADR-005: reads return the version of a record; every write to an existing record sends it
// back in If-Match, as a strong entity tag ("4"). A stale one answers 412 with the current
// version, a missing one 428 (RFC 9110, RFC 6585). "*" names no version: it counts as missing.

/** The request headers of a write to an existing record. */
export const ifMatch = z.object({
  'if-match': z
    .string()
    .regex(/^"[1-9]\d{0,8}"$/)
    .openapi({
      description: 'The version of the record the write starts from, as a strong entity tag',
      example: '"4"',
    }),
});

/** The version an If-Match header names, once the schema has checked it. */
export const versionOf = (headers: z.infer<typeof ifMatch>) =>
  Number(headers['if-match'].slice(1, -1));

export const Stale = z
  .object({ error: z.literal('stale'), version: z.number().int() })
  .openapi('Stale');

export const PreconditionRequired = z
  .object({ error: z.literal('precondition-required'), message: z.string() })
  .openapi('PreconditionRequired');

/** What every write to an existing record can answer besides its own statuses. */
export const guardedAnswers = {
  412: {
    content: { 'application/json': { schema: Stale } },
    description: 'The record changed since that version was read; the body names the current one',
  },
  428: {
    content: { 'application/json': { schema: PreconditionRequired } },
    description: 'If-Match is missing',
  },
};

/** The body of a 412. */
export const staleBody = (version: number) => ({ error: 'stale' as const, version });
