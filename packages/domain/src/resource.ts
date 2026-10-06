/** Driver, power unit (tractor, rigid truck, light van) or trailer. */
export const resourceKinds = ['driver', 'power-unit', 'trailer'] as const;
export type ResourceKind = (typeof resourceKinds)[number];

export type Resource = {
  readonly id: string;
  readonly kind: ResourceKind;
  readonly name: string;
};
