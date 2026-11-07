import { StaleVersionError } from './ports.ts';

/**
 * ADR-005: the answer to a write that names a version no longer current. It carries the current
 * one; the person reloads the record and redoes the change.
 */
export type Stale = { readonly ok: false; readonly reason: 'stale'; readonly version: number };

export const stale = (version: number): Stale => ({ ok: false, reason: 'stale', version });

/**
 * Runs a write the repository checks against the version; a write that lost the race since the
 * use case read the record answers stale, as one found stale on reading.
 */
export async function guarded<T>(run: () => Promise<T>): Promise<T | Stale> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof StaleVersionError) return stale(error.version);
    throw error;
  }
}
