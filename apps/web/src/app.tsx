import '@timon/ui/styles.css';
import './app.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  redirect,
  useRouterState,
} from '@tanstack/react-router';
import { Banner } from '@timon/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { kindFromSlug } from './kinds.ts';
import { LanguageSwitch } from './language-switch.tsx';
import { m } from './paraglide/messages.js';
import { getLocale } from './paraglide/runtime.js';
import { ExpiriesPage } from './resources/expiries-page.tsx';
import { ImportPage } from './resources/import-page.tsx';
import { ListPage } from './resources/list-page.tsx';
import { ResourcePage } from './resources/resource-page.tsx';

/** The section link stays current on every page under /resources. */
function ResourcesLink() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  return (
    <Link
      to="/resources/$kind"
      params={{ kind: 'drivers' }}
      className="appbar-link"
      activeOptions={{ exact: true }}
      aria-current={path.startsWith('/resources') ? 'page' : undefined}
    >
      {m.nav_resources()}
    </Link>
  );
}

const rootRoute = createRootRoute({
  component: () => (
    <div className="layout">
      <header className="appbar">
        <span className="wordmark">Timon</span>
        <nav aria-label={m.nav_main()}>
          <ul className="appbar-nav">
            <li>
              <ResourcesLink />
            </li>
          </ul>
        </nav>
        <LanguageSwitch />
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  ),
  notFoundComponent: () => (
    <div className="page">
      <Banner tone="warning">{m.not_found()}</Banner>
    </div>
  ),
});

// Resources is the home screen.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/resources/$kind', params: { kind: 'drivers' } });
  },
});

const expiriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/resources/expiries',
  component: ExpiriesPage,
});

const kindOf = (slug: string) => {
  const kind = kindFromSlug(slug);
  if (!kind) throw redirect({ to: '/resources/$kind', params: { kind: 'drivers' } });
  return kind;
};

export const listRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/resources/$kind',
  validateSearch: (search: Record<string, unknown>): { imported?: number } => {
    const imported = Number(search.imported);
    return Number.isInteger(imported) && imported > 0 ? { imported } : {};
  },
  component: function List() {
    const { kind } = listRoute.useParams();
    const { imported } = listRoute.useSearch();
    return <ListPage key={kind} kind={kindOf(kind)} imported={imported} />;
  },
});

const newRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/resources/$kind/new',
  component: function New() {
    const { kind } = newRoute.useParams();
    return <ResourcePage key={kind} kind={kindOf(kind)} />;
  },
});

const importRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/resources/$kind/import',
  component: function Import() {
    const { kind } = importRoute.useParams();
    return <ImportPage key={kind} kind={kindOf(kind)} />;
  },
});

const resourceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/resources/$kind/$id',
  component: function Resource() {
    const { kind, id } = resourceRoute.useParams();
    return <ResourcePage key={id} kind={kindOf(kind)} id={id} />;
  },
});

const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    expiriesRoute,
    listRoute,
    newRoute,
    importRoute,
    resourceRoute,
  ]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

/** Renders the application into `element`. Used by the web entry and by the demo shell. */
export function mount(element: HTMLElement) {
  // One retry: the demo's service worker restarts its database on the next request.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
  document.documentElement.lang = getLocale();
  createRoot(element).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}

const notices = {
  'service-worker-unavailable': m.demo_service_worker_unavailable,
} as const;

/** Renders a single notice in place of the application, when it cannot start. */
export function mountNotice(element: HTMLElement, notice: keyof typeof notices) {
  document.documentElement.lang = getLocale();
  createRoot(element).render(
    <div className="page">
      <Banner tone="warning">{notices[notice]()}</Banner>
    </div>,
  );
}
