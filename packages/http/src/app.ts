import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { createBooking, listBookings, listResources, type Ports } from '@timon/app';
import { periodOf, type ResourceBooking } from '@timon/domain';
import { Booking, NewBooking, Overlap, Problem, Resource } from './schemas.ts';

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
});

const toBooking = ({ period, ...booking }: ResourceBooking): z.infer<typeof Booking> => ({
  ...booking,
  start: period.start.toString(),
  end: period.end.toString(),
});

const listResourcesRoute = createRoute({
  method: 'get',
  path: '/resources',
  responses: { 200: json(z.array(Resource), 'Drivers, power units and trailers') },
});

const listBookingsRoute = createRoute({
  method: 'get',
  path: '/resources/{resourceId}/bookings',
  request: { params: z.object({ resourceId: z.uuid() }) },
  responses: { 200: json(z.array(Booking), 'Bookings of the resource, by start') },
});

const createBookingRoute = createRoute({
  method: 'post',
  path: '/bookings',
  request: { body: { ...json(NewBooking, 'The booking to create'), required: true } },
  responses: {
    201: json(Booking, 'Booking created'),
    400: json(Problem, 'Invalid request'),
    404: json(Problem, 'Unknown resource'),
    409: json(Overlap, 'The resource is already booked over part of the period'),
  },
});

/**
 * The HTTP API, independent of where it runs: Node with PostgreSQL, or the demo's service
 * worker with PGlite.
 */
export function createApp(ports: Ports) {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          { error: 'invalid-request' as const, message: z.prettifyError(result.error) },
          400,
        );
      }
    },
  })
    .basePath('/api')
    .openapi(listResourcesRoute, async (c) => c.json(await listResources(ports), 200))
    .openapi(listBookingsRoute, async (c) => {
      const bookings = await listBookings(ports, c.req.valid('param').resourceId);
      return c.json(bookings.map(toBooking), 200);
    })
    .openapi(createBookingRoute, async (c) => {
      const { resourceId, start, end, label } = c.req.valid('json');
      const result = await createBooking(ports, {
        resourceId,
        label,
        period: periodOf(start, end),
      });
      if (result.ok) return c.json(toBooking(result.booking), 201);
      if (result.reason === 'unknown-resource') {
        return c.json({ error: 'unknown-resource' as const, message: 'Unknown resource' }, 404);
      }
      return c.json(
        {
          error: 'overlap' as const,
          message: 'The resource is already booked over part of this period',
          conflicts: result.conflicts.map(toBooking),
        },
        409,
      );
    });

  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Timon API', version: '0.0.0' },
  });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
