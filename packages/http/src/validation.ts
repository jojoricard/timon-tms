import type { Hook } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';

/** A request the schemas refuse answers 400 with a readable message, on every route. */
// biome-ignore lint/suspicious/noExplicitAny: the hook serves routes of any shape.
export const validationHook: Hook<unknown, any, any, unknown> = (result, c) => {
  if (!result.success) {
    return c.json(
      { error: 'invalid-request' as const, message: z.prettifyError(result.error) },
      400,
    );
  }
};
