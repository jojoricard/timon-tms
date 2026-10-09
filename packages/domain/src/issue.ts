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
    | 'weight-not-positive'
    | 'combination-not-above-vehicle'
    | 'combination-not-allowed'
    | 'body-type-not-allowed'
    | 'code-invalid'
    | 'siret-invalid'
    | 'siret-not-french'
    | 'country-unknown'
    | 'contact-unreachable'
    | 'email-invalid'
    | 'postcode-invalid'
    | 'value-not-positive'
    | 'booking-method-required'
    | 'location-invalid'
    | 'opening-invalid'
    | 'opening-overlap';
  readonly params?: Readonly<Record<string, string | number>>;
};

export const blank = (value: string | null | undefined) => !value || value.trim() === '';
