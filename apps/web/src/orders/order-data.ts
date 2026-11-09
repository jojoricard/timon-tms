import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ok } from '../api.ts';
import { customerKeys } from '../customers/customer-data.ts';
import type { OrdersSearch } from '../list-search.ts';

export const orderKeys = {
  all: ['orders'] as const,
  list: (search: OrdersSearch) => ['orders', 'list', search] as const,
  order: (id: string) => ['orders', 'one', id] as const,
  history: (id: string) => ['orders', 'history', id] as const,
};

export function useOrders(search: OrdersSearch) {
  return useQuery({
    queryKey: orderKeys.list(search),
    queryFn: async () =>
      ok(
        await api.orders.$get({
          query: {
            ...(search.q ? { q: search.q } : {}),
            ...(search.status ? { status: search.status } : {}),
            ...(search.cancelled ? { cancelled: 'true' as const } : {}),
            ...(search.from ? { from: search.from } : {}),
            ...(search.to ? { to: search.to } : {}),
            ...(search.customer ? { customer: search.customer } : {}),
          },
        }),
      ),
    placeholderData: (previous) => previous,
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: orderKeys.order(id ?? ''),
    enabled: id !== undefined,
    queryFn: async () => ok(await api.orders[':id'].$get({ param: { id: id ?? '' } })),
  });
}

export function useOrderHistory(id: string | undefined) {
  return useQuery({
    queryKey: orderKeys.history(id ?? ''),
    enabled: id !== undefined,
    queryFn: async () => ok(await api.orders[':id'].history.$get({ param: { id: id ?? '' } })),
  });
}

/** After a write, the lists, the history and the customers' and sites' archiving may move. */
export function useRefreshOrders() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orderKeys.all }),
      queryClient.invalidateQueries({ queryKey: customerKeys.all }),
    ]);
}
