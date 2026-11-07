import { z } from '@hono/zod-openapi';
import { suggestionLimits } from '@timon/app';
import { bookingMethods, locatedByValues, textLimits } from '@timon/domain';
import { Issue } from './schemas.ts';

const instant = z.iso.datetime({ offset: true });
const day = z.iso.date();
const text = (max: number) => z.string().max(max).nullable().optional();

export const LocatedBy = z.enum(locatedByValues).openapi('LocatedBy');

export const Opening = z
  .object({
    weekday: z.number().int().min(1).max(7),
    startMinute: z.number().int().min(0).max(1440),
    endMinute: z.number().int().min(0).max(1440),
  })
  .openapi('Opening');

export const Contact = z
  .object({
    id: z.uuid(),
    name: z.string(),
    role: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  })
  .openapi('Contact');

export const Site = z
  .object({
    id: z.uuid(),
    version: z.number().int(),
    name: z.string(),
    street1: z.string(),
    street2: z.string().nullable(),
    postcode: z.string(),
    city: z.string(),
    country: z.string(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    locatedBy: LocatedBy,
    timeZone: z.string(),
    openings: z.array(Opening),
    bookingRequired: z.boolean(),
    bookingMethod: z.enum(bookingMethods).nullable(),
    bookingDetail: z.string().nullable(),
    protectiveEquipmentIds: z.array(z.uuid()),
    maxLengthCm: z.number().int().nullable(),
    maxWeightKg: z.number().int().nullable(),
    loadingDock: z.boolean(),
    semiTrailersAccepted: z.boolean(),
    gatePhone: z.string().nullable(),
    instructions: z.string().nullable(),
    archived: z.boolean(),
    createdAt: instant,
    updatedAt: instant,
    customerIds: z.array(z.uuid()),
    today: z.object({ weekday: z.number().int(), openings: z.array(Opening) }),
  })
  .openapi('Site');

export const NearbySite = z
  .object({
    id: z.uuid(),
    name: z.string(),
    distanceMetres: z.number().int().nullable(),
    sameStreet: z.boolean(),
  })
  .openapi('NearbySite');

export const SiteWithNearby = z
  .object({ site: Site, nearby: z.array(NearbySite) })
  .openapi('SiteWithNearby');

export const SiteList = z
  .object({
    day,
    counts: z.object({
      all: z.number(),
      'not-located': z.number(),
      booking: z.number(),
      'protective-equipment': z.number(),
    }),
    sites: z.array(Site),
  })
  .openapi('SiteList');

export const SiteInput = z
  .object({
    name: z.string().max(textLimits.site.name),
    street1: z.string().max(textLimits.site.street1),
    street2: text(textLimits.site.street2),
    postcode: z.string().max(textLimits.site.postcode),
    city: z.string().max(textLimits.site.city),
    country: z.string().length(2),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    locatedBy: LocatedBy,
    openings: z.array(Opening).max(70),
    bookingRequired: z.boolean(),
    bookingMethod: z.enum(bookingMethods).nullable().optional(),
    bookingDetail: text(textLimits.site.bookingDetail),
    protectiveEquipmentIds: z.array(z.uuid()).max(20),
    maxLengthCm: z.number().int().nullable().optional(),
    maxWeightKg: z.number().int().nullable().optional(),
    loadingDock: z.boolean(),
    semiTrailersAccepted: z.boolean(),
    gatePhone: text(textLimits.site.gatePhone),
    instructions: text(textLimits.site.instructions),
  })
  .openapi('SiteInput');

export const NearbyQuery = z
  .object({
    street1: z.string().max(200),
    postcode: z.string().max(20),
    country: z.string().length(2),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    exceptId: z.uuid().optional(),
  })
  .openapi('NearbyQuery');

export const Customer = z
  .object({
    id: z.uuid(),
    /** ADR-005: contacts and usual sites are saved under it. */
    version: z.number().int(),
    code: z.string(),
    name: z.string(),
    country: z.string(),
    siret: z.string().nullable(),
    vatNumber: z.string().nullable(),
    billingStreet1: z.string().nullable(),
    billingStreet2: z.string().nullable(),
    billingPostcode: z.string().nullable(),
    billingCity: z.string().nullable(),
    notes: z.string().nullable(),
    archived: z.boolean(),
    createdAt: instant,
    updatedAt: instant,
    contacts: z.array(Contact),
    siteIds: z.array(z.uuid()),
  })
  .openapi('Customer');

export const CustomerWithSites = Customer.extend({ sites: z.array(Site) }).openapi(
  'CustomerWithSites',
);

export const CustomerList = z
  .object({
    day,
    counts: z.object({ all: z.number(), france: z.number(), abroad: z.number() }),
    customers: z.array(Customer),
  })
  .openapi('CustomerList');

export const CustomerInput = z
  .object({
    code: z.string().max(textLimits.customer.code),
    name: z.string().max(textLimits.customer.name),
    country: z.string().length(2),
    siret: text(textLimits.customer.siret),
    vatNumber: text(textLimits.customer.vatNumber),
    billingStreet1: text(textLimits.customer.billingStreet1),
    billingStreet2: text(textLimits.customer.billingStreet2),
    billingPostcode: text(textLimits.customer.billingPostcode),
    billingCity: text(textLimits.customer.billingCity),
    notes: text(textLimits.customer.notes),
    contacts: z
      .array(
        z.object({
          id: z.uuid().optional(),
          name: z.string().max(textLimits.contact.name),
          role: text(textLimits.contact.role),
          phone: text(textLimits.contact.phone),
          email: text(textLimits.contact.email),
        }),
      )
      .max(50),
    siteIds: z.array(z.uuid()).max(500),
  })
  .openapi('CustomerInput');

export const CustomerOwner = z
  .object({ id: z.uuid(), code: z.string(), name: z.string(), archived: z.boolean() })
  .openapi('CustomerOwner');

export const CustomerTaken = z
  .object({ error: z.enum(['code-taken', 'siret-taken']), owner: CustomerOwner })
  .openapi('CustomerTaken');

export const CustomerSummary = z
  .object({ customers: z.number(), sites: z.number() })
  .openapi('CustomerSummary');

export const AddressSuggestions = z
  .object({
    available: z.boolean(),
    candidates: z.array(
      z.object({
        label: z.string(),
        street: z.string(),
        postcode: z.string(),
        city: z.string(),
        country: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        precision: z.enum(['address', 'street', 'city']),
        score: z.number(),
      }),
    ),
  })
  .openapi('AddressSuggestions');

/** Bounded, so that the API is not an open proxy to the geocoding service. */
export const SuggestionQuery = z.object({
  q: z.string().trim().min(suggestionLimits.minLength).max(suggestionLimits.maxLength),
  country: z.enum(['FR']).default('FR'),
  limit: z.coerce.number().int().min(1).max(suggestionLimits.maxResults).default(5),
});

const FileProblem = z
  .object({ code: z.string(), params: z.record(z.string(), z.unknown()).optional() })
  .nullable();

export const CustomerImportCheck = z
  .object({
    problem: FileProblem,
    rows: z.array(
      z.object({
        line: z.number().int(),
        cells: z.record(z.string(), z.string()),
        issues: z.array(Issue),
      }),
    ),
    summary: z.object({
      lines: z.number(),
      valid: z.number(),
      invalid: z.number(),
      alreadyInTimon: z.number(),
      contacts: z.number(),
    }),
    ready: z.boolean(),
  })
  .openapi('CustomerImportCheck');

export const SiteImportCheck = z
  .object({
    problem: FileProblem,
    rows: z.array(
      z.object({
        line: z.number().int(),
        cells: z.record(z.string(), z.string()),
        issues: z.array(Issue),
        locatedBy: LocatedBy.nullable(),
        latitude: z.number().nullable(),
        longitude: z.number().nullable(),
        nearby: z.array(NearbySite),
      }),
    ),
    summary: z.object({
      lines: z.number(),
      valid: z.number(),
      invalid: z.number(),
      address: z.number(),
      approximate: z.number(),
      byHand: z.number(),
      notLocated: z.number(),
      nearExisting: z.number(),
    }),
    ready: z.boolean(),
  })
  .openapi('SiteImportCheck');

/**
 * Confirming a site import sends the locations the preview found back with the file. They are
 * the user's own input, like the file: kept only when valid, otherwise not located.
 */
export const SiteImportInput = z
  .object({
    csv: z.string(),
    locations: z
      .array(
        z.object({
          line: z.number().int(),
          latitude: z.number().nullable(),
          longitude: z.number().nullable(),
          locatedBy: z.string().max(20),
        }),
      )
      .max(2000)
      .default([]),
  })
  .openapi('SiteImportInput');
