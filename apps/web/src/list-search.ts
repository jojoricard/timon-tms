/*
 * What a list shows lives in its address: the search, the filter, the archived records. A reload,
 * a shared link or the back button finds the same list. A value at its default is left out.
 */

/** A change to the search params of a page: a value, `undefined` to remove it. */
export type SearchPatch<S> = { [K in keyof S]?: S[K] | undefined };

/**
 * Changes the search params of the page. A function receives the params as they are when the
 * change runs, not as they were when the page rendered: quick clicks each count. `replace` keeps
 * the history to one entry, for a search typed letter by letter.
 */
export type SetSearch<S> = (
  patch: SearchPatch<S> | ((current: S) => SearchPatch<S>),
  options?: { replace?: boolean },
) => void;

/** Text typed in a search field; empty is no search. */
export const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** One of a few values; anything else is the default. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.find((v) => v === value);
}

/** A switch that is on, as `?archived=true`. */
export const flag = (value: unknown): true | undefined =>
  value === true || value === 'true' ? true : undefined;

/** The params without those left at their default. */
export function clean<S extends object>(search: SearchPatch<S>): S {
  return Object.fromEntries(Object.entries(search).filter(([, v]) => v !== undefined)) as S;
}

/**
 * The params after a change. `drop` names those that only make sense once, as the count of an
 * import just done: they go with any change.
 */
export function applySearch<S extends object>(
  current: S,
  patch: SearchPatch<S> | ((current: S) => SearchPatch<S>),
  drop: readonly (keyof S)[] = [],
): S {
  const next: SearchPatch<S> = {
    ...current,
    ...(typeof patch === 'function' ? patch(current) : patch),
  };
  for (const key of drop) delete next[key];
  return clean<S>(next);
}

export type ResourceListSearch = {
  q?: string;
  status?: 'expiring' | 'expired';
  archived?: true;
};

export type ExpiriesSearch = { kind?: 'driver' | 'power-unit' | 'trailer'; blocking?: true };

export type UnitsSearch = { at?: string; q?: string; filter?: 'documents' | 'no-driver' };

export type CustomersSearch = { q?: string; country?: 'france' | 'abroad'; archived?: true };

export type SitesSearch = {
  q?: string;
  filter?: 'not-located' | 'booking' | 'protective-equipment';
  archived?: true;
};
