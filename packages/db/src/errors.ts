import {
  BookingOverlapError,
  CustomerCodeTakenError,
  DocumentTypeTakenError,
  OpeningOverlapError,
  PlateTakenError,
  SiretTakenError,
} from '@timon/app';

// The database is the last word on these rules: its violations become the errors of the ports.
const violations: Record<string, () => Error> = {
  customer_company_code: () => new CustomerCodeTakenError('Customer code already used'),
  customer_active_siret: () => new SiretTakenError('SIRET used by another active customer'),
  site_opening_no_overlap: () => new OpeningOverlapError('Opening ranges overlap'),
  site_opening_site_id_weekday_start_minute_pk: () =>
    new OpeningOverlapError('Opening ranges overlap'),
  resource_booking_no_overlap: () => new BookingOverlapError('Overlapping booking'),
  resource_active_plate: () => new PlateTakenError('Plate used by another active resource'),
  document_resource_type: () => new DocumentTypeTakenError('Document type already recorded'),
};

export async function translateErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const constraint = violatedConstraint(error);
    const translated = constraint ? violations[constraint]?.() : undefined;
    if (translated) throw Object.assign(translated, { cause: error });
    throw error;
  }
}

// node-postgres and PGlite both expose the SQLSTATE as `code` and the constraint name;
// Drizzle may wrap the error in `cause`.
function violatedConstraint(error: unknown): string | undefined {
  for (let e = error; e instanceof Object; e = (e as { cause?: unknown }).cause) {
    const { code, constraint } = e as { code?: unknown; constraint?: unknown };
    if (code === '23P01' || code === '23505') {
      return typeof constraint === 'string' ? constraint : undefined;
    }
  }
  return undefined;
}
