import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ResourceKind } from '@timon/domain';
import { ApiError, api, ok } from './api.ts';
import { m } from './paraglide/messages.js';

export type StatusFilter = 'all' | 'expiring' | 'expired';

export const keys = {
  all: ['resources'] as const,
  summary: ['resources', 'summary'] as const,
  list: (kind: ResourceKind, q: string, status: StatusFilter, archived: boolean) =>
    ['resources', 'list', kind, q, status, archived] as const,
  resource: (id: string) => ['resources', 'one', id] as const,
  expiries: (kind: ResourceKind | undefined, blocking: boolean) =>
    ['resources', 'expiries', kind ?? 'all', blocking] as const,
  lists: ['reference-lists'] as const,
};

export function useSummary() {
  return useQuery({
    queryKey: keys.summary,
    queryFn: async () => ok(await api.resources.summary.$get()),
  });
}

export function useResourceList(
  kind: ResourceKind,
  q: string,
  status: StatusFilter,
  archived: boolean,
) {
  return useQuery({
    queryKey: keys.list(kind, q, status, archived),
    queryFn: async () =>
      ok(
        await api.resources.$get({
          query: {
            kind,
            ...(q ? { q } : {}),
            ...(status === 'all' ? {} : { status }),
            ...(archived ? { archived: 'true' as const } : {}),
          },
        }),
      ),
    placeholderData: (previous) => previous,
  });
}

export function useResource(id: string | undefined) {
  return useQuery({
    queryKey: keys.resource(id ?? ''),
    enabled: id !== undefined,
    queryFn: async () => ok(await api.resources[':id'].$get({ param: { id: id ?? '' } })),
  });
}

export function useReferenceLists() {
  return useQuery({
    queryKey: keys.lists,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => ok(await api['reference-lists'].$get()),
  });
}

export function useExpiries(kind: ResourceKind | undefined, blocking: boolean) {
  return useQuery({
    queryKey: keys.expiries(kind, blocking),
    queryFn: async () =>
      ok(
        await api.expiries.$get({
          query: { ...(kind ? { kind } : {}), ...(blocking ? { blocking: 'true' as const } : {}) },
        }),
      ),
    placeholderData: (previous) => previous,
  });
}

/** After a write, every list and count may have moved. */
export function useRefreshResources() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: keys.all });
}

/** What went wrong with a request, in the interface's language. */
export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'demo-unavailable') return m.demo_unavailable();
    if (error.code === 'not-found') return m.not_found();
    return m.request_failed({ status: error.status });
  }
  return m.server_unreachable();
}
