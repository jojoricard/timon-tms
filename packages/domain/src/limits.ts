/**
 * The longest text each input accepts, in characters. The API refuses a longer value with an
 * issue on its field; the forms give the same limit to their fields, so it is never reached by
 * typing. A column that has a length in the database has this same length.
 */
export const textLimits = {
  resource: {
    lastName: 200,
    firstName: 200,
    displayName: 200,
    employeeNumber: 200,
    phone: 200,
    plate: 20,
    makeModel: 200,
  },
  document: { reference: 200 },
  customer: {
    code: 40,
    name: 200,
    siret: 30,
    vatNumber: 30,
    billingStreet1: 200,
    billingStreet2: 200,
    billingPostcode: 20,
    billingCity: 100,
    notes: 2000,
  },
  contact: { name: 200, role: 200, phone: 40, email: 200 },
  site: {
    name: 200,
    street1: 200,
    street2: 200,
    postcode: 20,
    city: 100,
    bookingDetail: 200,
    gatePhone: 40,
    instructions: 2000,
  },
  unit: { name: 100 },
} as const;

export type TextLimits = typeof textLimits;
