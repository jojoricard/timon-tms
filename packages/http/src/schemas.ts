import { z } from '@hono/zod-openapi';
import { resourceKinds } from '@timon/domain';

const instant = z.iso.datetime({ offset: true }).openapi({ example: '2026-10-07T06:00:00Z' });

export const Resource = z
  .object({
    id: z.uuid(),
    kind: z.enum(resourceKinds),
    name: z.string(),
  })
  .openapi('Resource');

export const Booking = z
  .object({
    id: z.uuid(),
    resourceId: z.uuid(),
    start: instant,
    end: instant,
    label: z.string(),
  })
  .openapi('Booking');

export const NewBooking = z
  .object({
    resourceId: z.uuid(),
    start: instant,
    end: instant,
    label: z.string().trim().min(1).max(200),
  })
  .refine((b) => Date.parse(b.end) > Date.parse(b.start), {
    message: 'end must be after start',
    path: ['end'],
  })
  .openapi('NewBooking');

export const Problem = z
  .object({
    error: z.enum(['invalid-request', 'unknown-resource', 'overlap']),
    message: z.string(),
  })
  .openapi('Problem');

export const Overlap = Problem.extend({ conflicts: z.array(Booking) }).openapi('Overlap');
