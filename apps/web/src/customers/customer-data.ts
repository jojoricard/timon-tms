import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ok } from '../api.ts';

export type CountryFilter = 'all' | 'france' | 'abroad';
export type SiteFilter = 'all' | 'not-located' | 'booking' | 'protective-equipment';

export const customerKeys = {
  all: ['customers'] as const,
  summary: ['customers', 'summary'] as const,
  customers: (q: string, country: CountryFilter, archived: boolean) =>
    ['customers', 'list', q, country, archived] as const,
  customer: (id: string) => ['customers', 'one', id] as const,
  sites: (q: string, filter: SiteFilter, archived: boolean) =>
    ['customers', 'sites', q, filter, archived] as const,
  site: (id: string) => ['customers', 'site', id] as const,
};

export function useCustomerSummary() {
  return useQuery({
    queryKey: customerKeys.summary,
    queryFn: async () => ok(await api.customers.summary.$get()),
  });
}

export function useCustomers(q: string, country: CountryFilter, archived: boolean) {
  return useQuery({
    queryKey: customerKeys.customers(q, country, archived),
    queryFn: async () =>
      ok(
        await api.customers.$get({
          query: {
            ...(q ? { q } : {}),
            ...(country === 'all' ? {} : { country }),
            ...(archived ? { archived: 'true' as const } : {}),
          },
        }),
      ),
    placeholderData: (previous) => previous,
  });
}

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: customerKeys.customer(id ?? ''),
    enabled: id !== undefined,
    queryFn: async () => ok(await api.customers[':id'].$get({ param: { id: id ?? '' } })),
  });
}

export function useSites(q: string, filter: SiteFilter, archived: boolean) {
  return useQuery({
    queryKey: customerKeys.sites(q, filter, archived),
    queryFn: async () =>
      ok(
        await api.sites.$get({
          query: {
            ...(q ? { q } : {}),
            ...(filter === 'all' ? {} : { filter }),
            ...(archived ? { archived: 'true' as const } : {}),
          },
        }),
      ),
    placeholderData: (previous) => previous,
  });
}

export function useSite(id: string | undefined) {
  return useQuery({
    queryKey: customerKeys.site(id ?? ''),
    enabled: id !== undefined,
    queryFn: async () => ok(await api.sites[':id'].$get({ param: { id: id ?? '' } })),
  });
}

/** A value that settles `delay` ms after the last change, for queries as you type. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/** Addresses of the national base matching what is typed; French sites only. */
export function useAddressSuggestions(query: string, country: string) {
  const q = useDebounced(query.trim());
  return useQuery({
    queryKey: ['geocoding', q, country],
    enabled: country === 'FR' && q.length >= 3,
    staleTime: 60_000,
    queryFn: async () =>
      ok(
        await api.geocoding.search.$get({
          query: { q: q.slice(0, 200), country: 'FR', limit: '5' },
        }),
      ),
  });
}

/** After a write, every customer and site list and count may have moved. */
export function useRefreshCustomers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: customerKeys.all });
}
