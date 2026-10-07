import type { ResourceKind } from '@timon/domain';
import { m } from './paraglide/messages.js';

/** Resource kinds as they appear in addresses: /resources/drivers. */
export const kindSlugs = {
  driver: 'drivers',
  'power-unit': 'power-units',
  trailer: 'trailers',
} as const satisfies Record<ResourceKind, string>;

export type KindSlug = (typeof kindSlugs)[ResourceKind];

export function kindFromSlug(slug: string): ResourceKind | undefined {
  return (Object.keys(kindSlugs) as ResourceKind[]).find((kind) => kindSlugs[kind] === slug);
}

export const tabLabel: Record<ResourceKind, () => string> = {
  driver: m.tab_drivers,
  'power-unit': m.tab_power_units,
  trailer: m.tab_trailers,
};

export const addLabel: Record<ResourceKind, () => string> = {
  driver: m.action_add_driver,
  'power-unit': m.action_add_power_unit,
  trailer: m.action_add_trailer,
};

export const newTitle: Record<ResourceKind, () => string> = {
  driver: m.new_driver,
  'power-unit': m.new_power_unit,
  trailer: m.new_trailer,
};

export const importTitle: Record<ResourceKind, () => string> = {
  driver: m.import_title_driver,
  'power-unit': m.import_title_power_unit,
  trailer: m.import_title_trailer,
};
