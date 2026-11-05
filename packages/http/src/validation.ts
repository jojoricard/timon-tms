import type { Hook } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';

type FieldIssue = { field: string; code: string; params?: Record<string, number> };

/**
 * The issues of a body the schemas refuse, each on its field, as the rules report theirs:
 * `contacts.0.email` for a field inside a list. A text over its limit is `too-long` with its
 * `max`; anything else is `invalid-value`, a request the forms never send.
 */
export function fieldIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => {
    const field = issue.path.join('.');
    if (issue.code === 'too_big' && issue.origin === 'string') {
      return { field, code: 'too-long', params: { max: Number(issue.maximum) } };
    }
    return { field, code: 'invalid-value' };
  });
}

/**
 * A request the schemas refuse answers 400, on every route. A body answers `invalid` with an
 * issue per field, the shape the rules use; only an issue with no field, or a refused query or
 * path, keeps the readable message alone.
 */
// biome-ignore lint/suspicious/noExplicitAny: the hook serves routes of any shape.
export const validationHook: Hook<unknown, any, any, unknown> = (result, c) => {
  if (result.success) return;
  if (result.target === 'json') {
    const issues = fieldIssues(result.error);
    if (issues.every((issue) => issue.field !== '')) {
      return c.json({ error: 'invalid' as const, issues }, 400);
    }
  }
  return c.json({ error: 'invalid-request' as const, message: z.prettifyError(result.error) }, 400);
};
