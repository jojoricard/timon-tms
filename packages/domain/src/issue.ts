/**
 * What is wrong with a record, as a code the interface translates. `field` names the input
 * the issue belongs to; `params` fills the message.
 */
export type Issue = {
  readonly field: string;
  readonly code:
    | 'required'
    | 'kind-not-allowed'
    | 'category-not-allowed'
    | 'category-weight-mismatch'
    | 'weight-not-positive'
    | 'combination-not-above-vehicle'
    | 'combination-not-allowed'
    | 'body-type-not-allowed'
    | 'code-invalid'
    | 'siret-invalid'
    | 'siret-not-french'
    | 'vat-invalid'
    | 'country-unknown'
    | 'contact-unreachable'
    | 'email-invalid'
    | 'phone-invalid'
    | 'postcode-invalid'
    | 'value-not-positive'
    | 'booking-method-required'
    | 'location-invalid'
    | 'opening-invalid'
    | 'opening-overlap'
    | 'driver-or-trailer-required'
    | 'light-van-no-trailer'
    | 'semi-trailer-needs-tractor'
    | 'drawbar-trailer-needs-rigid-truck'
    | 'resource-archived'
    | 'subsidiary-mismatch'
    | 'licence-missing'
    | 'licence-not-supported'
    | 'not-to-the-minute'
    | 'end-not-after-start'
    | 'pickup-required'
    | 'delivery-required'
    | 'stop-without-goods'
    | 'delivery-before-pickup'
    | 'several-pickups-and-deliveries'
    | 'site-not-located'
    | 'un-number-invalid'
    | 'temperature-out-of-range'
    | 'temperature-range-invalid'
    | 'split-group-empty'
    | 'unknown-value';
  readonly params?: Readonly<Record<string, string | number>>;
};

export const blank = (value: string | null | undefined) => !value || value.trim() === '';
