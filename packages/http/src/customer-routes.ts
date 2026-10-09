import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  type CustomerView,
  checkCustomerImport,
  checkSiteImport,
  countryFilters,
  createCustomer,
  createSite,
  customerSummary,
  customerTemplate,
  findNearbySites,
  getCustomer,
  getSite,
  importCustomers,
  importSites,
  listCustomers,
  listSites,
  type Ports,
  type SiteImportCheck as SiteImportCheckView,
  type SiteView,
  type StoredCustomer,
  setCustomerArchived,
  setSiteArchived,
  siteFilters,
  siteTemplate,
  suggestAddresses,
  updateCustomer,
  updateSite,
} from '@timon/app';
import type { SiteDetails, Weekday } from '@timon/domain';
import {
  AddressSuggestions,
  type Customer,
  CustomerImportCheck,
  CustomerInput,
  CustomerList,
  CustomerSummary,
  CustomerTaken,
  CustomerWithSites,
  NearbyQuery,
  NearbySite,
  type Site,
  SiteImportCheck,
  SiteImportInput,
  SiteInput,
  SiteList,
  SiteWithNearby,
  SuggestionQuery,
} from './customer-schemas.ts';
import { ImportInput, Invalid, Problem } from './schemas.ts';
import { validationHook } from './validation.ts';

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { ...json(schema, 'Request body'), required: true },
});
const id = z.object({ id: z.uuid() });
const flag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');
const language = z.object({ lang: z.enum(['en', 'fr']).optional() });

export function toSite(s: SiteView): z.infer<typeof Site> {
  const { location, today, openings, ...rest } = s;
  return {
    ...rest,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    openings: [...openings],
    protectiveEquipmentIds: [...s.protectiveEquipmentIds],
    customerIds: [...s.customerIds],
    today: { weekday: today.weekday, openings: [...today.openings] },
    createdAt: s.createdAt.toString(),
    updatedAt: s.updatedAt.toString(),
  };
}

export function toCustomer(c: StoredCustomer): z.infer<typeof Customer> {
  return {
    ...c,
    contacts: c.contacts.map((x) => ({ ...x })),
    siteIds: [...c.siteIds],
    createdAt: c.createdAt.toString(),
    updatedAt: c.updatedAt.toString(),
  };
}

const withSites = (c: CustomerView) => ({ ...toCustomer(c), sites: c.sites.map(toSite) });

function fromSiteInput(input: z.infer<typeof SiteInput>): SiteDetails {
  const located = input.latitude !== null && input.longitude !== null;
  return {
    name: input.name,
    street1: input.street1,
    street2: input.street2 ?? null,
    postcode: input.postcode,
    city: input.city,
    country: input.country,
    location: located ? { latitude: input.latitude ?? 0, longitude: input.longitude ?? 0 } : null,
    locatedBy: located ? input.locatedBy : 'not-located',
    openings: input.openings.map((o) => ({ ...o, weekday: o.weekday as Weekday })),
    bookingRequired: input.bookingRequired,
    bookingMethod: input.bookingMethod ?? null,
    bookingDetail: input.bookingDetail ?? null,
    protectiveEquipmentIds: input.protectiveEquipmentIds,
    maxLengthCm: input.maxLengthCm ?? null,
    maxWeightKg: input.maxWeightKg ?? null,
    loadingDock: input.loadingDock,
    semiTrailersAccepted: input.semiTrailersAccepted,
    gatePhone: input.gatePhone ?? null,
    instructions: input.instructions ?? null,
  };
}

function fromCustomerInput(input: z.infer<typeof CustomerInput>) {
  return {
    code: input.code,
    name: input.name,
    country: input.country,
    siret: input.siret ?? null,
    vatNumber: input.vatNumber ?? null,
    billingStreet1: input.billingStreet1 ?? null,
    billingStreet2: input.billingStreet2 ?? null,
    billingPostcode: input.billingPostcode ?? null,
    billingCity: input.billingCity ?? null,
    notes: input.notes ?? null,
    contacts: input.contacts.map((c) => ({
      ...(c.id ? { id: c.id } : {}),
      name: c.name,
      role: c.role ?? null,
      phone: c.phone ?? null,
      email: c.email ?? null,
    })),
    siteIds: input.siteIds,
  };
}

const toSiteImportCheck = (check: SiteImportCheckView): z.infer<typeof SiteImportCheck> => ({
  ...check,
  rows: check.rows.map(({ location, issues, nearby, cells, ...row }) => ({
    ...row,
    cells: { ...cells },
    issues: issues.map((i) => ({ ...i })),
    nearby: [...nearby],
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
  })),
});

const customerAnswers = {
  200: json(CustomerWithSites, 'The customer, with its contacts and usual sites'),
  400: json(z.union([Invalid, Problem]), 'A rule is broken; each issue names its field'),
  404: json(Problem, 'No such customer'),
  409: json(CustomerTaken, 'Code or SIRET of another customer (rule 1)'),
};

const siteAnswers = {
  200: json(SiteWithNearby, 'The site, with the active sites near it (a warning, rule 5)'),
  400: json(z.union([Invalid, Problem]), 'A rule is broken; each issue names its field'),
  404: json(Problem, 'No such site'),
};

const routes = {
  customerSummary: createRoute({
    method: 'get',
    path: '/customers/summary',
    responses: { 200: json(CustomerSummary, 'Active customers and sites') },
  }),
  listCustomers: createRoute({
    method: 'get',
    path: '/customers',
    request: {
      query: z.object({
        q: z.string().max(100).optional(),
        country: z.enum(countryFilters).optional(),
        archived: flag,
      }),
    },
    responses: { 200: json(CustomerList, 'Customers by code') },
  }),
  getCustomer: createRoute({
    method: 'get',
    path: '/customers/{id}',
    request: { params: id },
    responses: { 200: customerAnswers[200], 404: customerAnswers[404] },
  }),
  createCustomer: createRoute({
    method: 'post',
    path: '/customers',
    request: body(CustomerInput),
    responses: { ...customerAnswers, 201: json(CustomerWithSites, 'Customer created') },
  }),
  updateCustomer: createRoute({
    method: 'put',
    path: '/customers/{id}',
    request: { params: id, ...body(CustomerInput) },
    responses: customerAnswers,
  }),
  archiveCustomer: createRoute({
    method: 'post',
    path: '/customers/{id}/archive',
    request: { params: id },
    responses: customerAnswers,
  }),
  restoreCustomer: createRoute({
    method: 'post',
    path: '/customers/{id}/restore',
    request: { params: id },
    responses: customerAnswers,
  }),
  listSites: createRoute({
    method: 'get',
    path: '/sites',
    request: {
      query: z.object({
        q: z.string().max(100).optional(),
        filter: z.enum(siteFilters).optional(),
        archived: flag,
      }),
    },
    responses: { 200: json(SiteList, 'The address book, by name') },
  }),
  nearbySites: createRoute({
    method: 'post',
    path: '/sites/nearby',
    request: body(NearbyQuery),
    responses: { 200: json(z.array(NearbySite), 'Active sites within 50 m or on the same street') },
  }),
  getSite: createRoute({
    method: 'get',
    path: '/sites/{id}',
    request: { params: id },
    responses: { 200: siteAnswers[200], 404: siteAnswers[404] },
  }),
  createSite: createRoute({
    method: 'post',
    path: '/sites',
    request: body(SiteInput),
    responses: { ...siteAnswers, 201: json(SiteWithNearby, 'Site created') },
  }),
  updateSite: createRoute({
    method: 'put',
    path: '/sites/{id}',
    request: { params: id, ...body(SiteInput) },
    responses: siteAnswers,
  }),
  archiveSite: createRoute({
    method: 'post',
    path: '/sites/{id}/archive',
    request: { params: id },
    responses: siteAnswers,
  }),
  restoreSite: createRoute({
    method: 'post',
    path: '/sites/{id}/restore',
    request: { params: id },
    responses: siteAnswers,
  }),
  suggestAddresses: createRoute({
    method: 'get',
    path: '/geocoding/search',
    request: { query: SuggestionQuery },
    responses: {
      200: json(AddressSuggestions, 'Addresses of the national base matching the query'),
      400: json(Problem, 'Query too short or too long, country other than FR, limit over 5'),
    },
  }),
  customerTemplate: createRoute({
    method: 'get',
    path: '/imports/customers/template',
    request: { query: language },
    responses: {
      200: { content: { 'text/csv': { schema: z.string() } }, description: 'CSV header line' },
    },
  }),
  checkCustomerImport: createRoute({
    method: 'post',
    path: '/imports/customers/check',
    request: body(ImportInput),
    responses: { 200: json(CustomerImportCheck, 'Every line with its issues; nothing is written') },
  }),
  importCustomers: createRoute({
    method: 'post',
    path: '/imports/customers',
    request: body(ImportInput),
    responses: {
      201: json(z.object({ imported: z.number().int() }), 'Every line imported'),
      422: json(
        z.object({ error: z.literal('import-invalid'), check: CustomerImportCheck }),
        'At least one line is invalid: nothing imported (rule 7)',
      ),
    },
  }),
  siteTemplate: createRoute({
    method: 'get',
    path: '/imports/sites/template',
    request: { query: language },
    responses: {
      200: { content: { 'text/csv': { schema: z.string() } }, description: 'CSV header line' },
    },
  }),
  checkSiteImport: createRoute({
    method: 'post',
    path: '/imports/sites/check',
    request: body(ImportInput),
    responses: {
      200: json(SiteImportCheck, 'Every line with its issues and location; nothing is written'),
    },
  }),
  importSites: createRoute({
    method: 'post',
    path: '/imports/sites',
    request: body(SiteImportInput),
    responses: {
      201: json(
        z.object({ imported: z.number().int(), notLocated: z.number().int() }),
        'Every line imported',
      ),
      422: json(
        z.object({ error: z.literal('import-invalid'), check: SiteImportCheck }),
        'At least one line is invalid: nothing imported (rule 7)',
      ),
    },
  }),
};

const csv = (c: { header: (name: string, value: string) => void }, name: string) =>
  c.header('Content-Disposition', `attachment; filename="${name}"`);

/** Customers, sites, address suggestions and their imports (SPEC-002). */
export function customerApi(ports: Ports) {
  return new OpenAPIHono({ defaultHook: validationHook })
    .openapi(routes.customerSummary, async (c) => c.json(await customerSummary(ports), 200))
    .openapi(routes.listCustomers, async (c) => {
      const { q, country, archived } = c.req.valid('query');
      const list = await listCustomers(ports, {
        includeArchived: archived,
        ...(q ? { query: q } : {}),
        ...(country ? { country } : {}),
      });
      return c.json(
        {
          day: list.day.toString(),
          counts: list.counts,
          customers: list.customers.map(toCustomer),
        },
        200,
      );
    })
    .openapi(routes.getCustomer, async (c) => {
      const customer = await getCustomer(ports, c.req.valid('param').id);
      return customer
        ? c.json(withSites(customer), 200)
        : c.json({ error: 'not-found' as const }, 404);
    })
    .openapi(routes.createCustomer, async (c) => {
      const result = await createCustomer(ports, fromCustomerInput(c.req.valid('json')));
      if (result.ok) return c.json(withSites(result.customer), 201);
      if (result.reason === 'not-found') return c.json({ error: 'not-found' as const }, 404);
      if (result.reason === 'invalid') {
        return c.json(
          { error: 'invalid' as const, issues: result.issues.map((i) => ({ ...i })) },
          400,
        );
      }
      return c.json({ error: result.reason, owner: result.owner }, 409);
    })
    .openapi(routes.updateCustomer, async (c) => {
      const result = await updateCustomer(
        ports,
        c.req.valid('param').id,
        fromCustomerInput(c.req.valid('json')),
      );
      if (result.ok) return c.json(withSites(result.customer), 200);
      if (result.reason === 'not-found') return c.json({ error: 'not-found' as const }, 404);
      if (result.reason === 'invalid') {
        return c.json(
          { error: 'invalid' as const, issues: result.issues.map((i) => ({ ...i })) },
          400,
        );
      }
      return c.json({ error: result.reason, owner: result.owner }, 409);
    })
    .openapi(routes.archiveCustomer, async (c) => {
      const result = await setCustomerArchived(ports, c.req.valid('param').id, true);
      if (result.ok) return c.json(withSites(result.customer), 200);
      if (result.reason === 'not-found') return c.json({ error: 'not-found' as const }, 404);
      if (result.reason === 'invalid') {
        return c.json(
          { error: 'invalid' as const, issues: result.issues.map((i) => ({ ...i })) },
          400,
        );
      }
      return c.json({ error: result.reason, owner: result.owner }, 409);
    })
    .openapi(routes.restoreCustomer, async (c) => {
      const result = await setCustomerArchived(ports, c.req.valid('param').id, false);
      if (result.ok) return c.json(withSites(result.customer), 200);
      if (result.reason === 'not-found') return c.json({ error: 'not-found' as const }, 404);
      if (result.reason === 'invalid') {
        return c.json(
          { error: 'invalid' as const, issues: result.issues.map((i) => ({ ...i })) },
          400,
        );
      }
      return c.json({ error: result.reason, owner: result.owner }, 409);
    })
    .openapi(routes.listSites, async (c) => {
      const { q, filter, archived } = c.req.valid('query');
      const list = await listSites(ports, {
        includeArchived: archived,
        ...(q ? { query: q } : {}),
        ...(filter ? { filter } : {}),
      });
      return c.json(
        { day: list.day.toString(), counts: list.counts, sites: list.sites.map(toSite) },
        200,
      );
    })
    .openapi(routes.nearbySites, async (c) => {
      const query = c.req.valid('json');
      const location =
        query.latitude !== null && query.longitude !== null
          ? { latitude: query.latitude, longitude: query.longitude }
          : null;
      return c.json(await findNearbySites(ports, { ...query, location }, query.exceptId), 200);
    })
    .openapi(routes.getSite, async (c) => {
      const found = await getSite(ports, c.req.valid('param').id);
      return found
        ? c.json({ site: toSite(found.site), nearby: [...found.nearby] }, 200)
        : c.json({ error: 'not-found' as const }, 404);
    })
    .openapi(routes.createSite, async (c) => {
      const result = await createSite(ports, fromSiteInput(c.req.valid('json')));
      if (result.ok) return c.json({ site: toSite(result.site), nearby: [...result.nearby] }, 201);
      if (result.reason === 'not-found') return c.json({ error: 'not-found' as const }, 404);
      return c.json(
        { error: 'invalid' as const, issues: result.issues.map((i) => ({ ...i })) },
        400,
      );
    })
    .openapi(routes.updateSite, async (c) => {
      const result = await updateSite(
        ports,
        c.req.valid('param').id,
        fromSiteInput(c.req.valid('json')),
      );
      if (result.ok) return c.json({ site: toSite(result.site), nearby: [...result.nearby] }, 200);
      if (result.reason === 'not-found') return c.json({ error: 'not-found' as const }, 404);
      return c.json(
        { error: 'invalid' as const, issues: result.issues.map((i) => ({ ...i })) },
        400,
      );
    })
    .openapi(routes.archiveSite, async (c) => {
      const result = await setSiteArchived(ports, c.req.valid('param').id, true);
      if (result.ok) return c.json({ site: toSite(result.site), nearby: [] }, 200);
      if (result.reason === 'not-found') return c.json({ error: 'not-found' as const }, 404);
      return c.json(
        { error: 'invalid' as const, issues: result.issues.map((i) => ({ ...i })) },
        400,
      );
    })
    .openapi(routes.restoreSite, async (c) => {
      const result = await setSiteArchived(ports, c.req.valid('param').id, false);
      if (result.ok) return c.json({ site: toSite(result.site), nearby: [] }, 200);
      if (result.reason === 'not-found') return c.json({ error: 'not-found' as const }, 404);
      return c.json(
        { error: 'invalid' as const, issues: result.issues.map((i) => ({ ...i })) },
        400,
      );
    })
    .openapi(routes.suggestAddresses, async (c) => {
      const { q, country, limit } = c.req.valid('query');
      return c.json(await suggestAddresses(ports.geocoder, q, { country, limit }), 200);
    })
    .openapi(routes.customerTemplate, (c) => {
      const lang = c.req.valid('query').lang ?? 'en';
      csv(c, `timon-customers-${lang}.csv`);
      return c.body(customerTemplate(lang), 200, { 'Content-Type': 'text/csv; charset=utf-8' });
    })
    .openapi(routes.checkCustomerImport, async (c) => {
      const check = await checkCustomerImport(ports, c.req.valid('json').csv);
      return c.json(check as z.infer<typeof CustomerImportCheck>, 200);
    })
    .openapi(routes.importCustomers, async (c) => {
      const result = await importCustomers(ports, c.req.valid('json').csv);
      if (result.ok) return c.json({ imported: result.imported }, 201);
      return c.json(
        {
          error: 'import-invalid' as const,
          check: result.check as z.infer<typeof CustomerImportCheck>,
        },
        422,
      );
    })
    .openapi(routes.siteTemplate, (c) => {
      const lang = c.req.valid('query').lang ?? 'en';
      csv(c, `timon-sites-${lang}.csv`);
      return c.body(siteTemplate(lang), 200, { 'Content-Type': 'text/csv; charset=utf-8' });
    })
    .openapi(routes.checkSiteImport, async (c) => {
      return c.json(toSiteImportCheck(await checkSiteImport(ports, c.req.valid('json').csv)), 200);
    })
    .openapi(routes.importSites, async (c) => {
      const { csv: file, locations } = c.req.valid('json');
      const result = await importSites(ports, file, locations);
      if (result.ok)
        return c.json({ imported: result.imported, notLocated: result.notLocated }, 201);
      return c.json(
        { error: 'import-invalid' as const, check: toSiteImportCheck(result.check) },
        422,
      );
    });
}
