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
import { CustomerPage } from './customers/customer-page.tsx';
import { CustomersPage } from './customers/customers-page.tsx';
import { CustomerImportPage, SiteImportPage } from './customers/import-pages.tsx';
import { SitePage } from './customers/site-page.tsx';
import { SitesPage } from './customers/sites-page.tsx';
import { kindFromSlug } from './kinds.ts';
import { LanguageSwitch } from './language-switch.tsx';
import { m } from './paraglide/messages.js';
import { getLocale } from './paraglide/runtime.js';
import { ExpiriesPage } from './resources/expiries-page.tsx';
import { ImportPage } from './resources/import-page.tsx';
import { ListPage } from './resources/list-page.tsx';
import { ResourcePage } from './resources/resource-page.tsx';
import { followRowLinks } from './row-links.ts';

/** A section link stays current on every page under its path. */
function SectionLinks() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  return (
    <>
      <li>
        <Link
          to="/resources/$kind"
          params={{ kind: 'drivers' }}
          className="appbar-link"
          activeOptions={{ exact: true }}
          aria-current={path.startsWith('/resources') ? 'page' : undefined}
        >
          {m.nav_resources()}
        </Link>
      </li>
      <li>
        <Link
          to="/customers"
          className="appbar-link"
          activeOptions={{ exact: true }}
          aria-current={path.startsWith('/customers') ? 'page' : undefined}
        >
          {m.nav_customers()}
        </Link>
      </li>
    </>
  );
}

const rootRoute = createRootRoute({
  component: () => (
    <div className="layout">
      <header className="appbar">
        <span className="wordmark">Timon</span>
        <nav aria-label={m.nav_main()}>
          <ul className="appbar-nav">
            <SectionLinks />
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

const count = (value: unknown) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

const customersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers',
  validateSearch: (search: Record<string, unknown>): { imported?: number } => {
    const imported = count(search.imported);
    return imported ? { imported } : {};
  },
  component: function Customers() {
    const { imported } = customersRoute.useSearch();
    return <CustomersPage imported={imported} />;
  },
});

const newCustomerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/new',
  component: () => <CustomerPage />,
});

const customerImportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/import',
  component: CustomerImportPage,
});

const sitesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/sites',
  validateSearch: (search: Record<string, unknown>): { imported?: number; notLocated?: number } => {
    const imported = count(search.imported);
    return imported ? { imported, notLocated: count(search.notLocated) ?? 0 } : {};
  },
  component: function Sites() {
    const { imported, notLocated } = sitesRoute.useSearch();
    return (
      <SitesPage
        imported={imported ? { count: imported, notLocated: notLocated ?? 0 } : undefined}
      />
    );
  },
});

const newSiteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/sites/new',
  validateSearch: (search: Record<string, unknown>): { customer?: string } =>
    typeof search.customer === 'string' ? { customer: search.customer } : {},
  component: function NewSite() {
    const { customer } = newSiteRoute.useSearch();
    return <SitePage customerId={customer} />;
  },
});

const siteImportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/sites/import',
  component: SiteImportPage,
});

const siteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/sites/$id',
  component: function Site() {
    const { id } = siteRoute.useParams();
    return <SitePage key={id} id={id} />;
  },
});

const customerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/$id',
  component: function Customer() {
    const { id } = customerRoute.useParams();
    return <CustomerPage key={id} id={id} />;
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
    customersRoute,
    newCustomerRoute,
    customerImportRoute,
    sitesRoute,
    newSiteRoute,
    siteImportRoute,
    siteRoute,
    customerRoute,
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
  followRowLinks(element);
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
