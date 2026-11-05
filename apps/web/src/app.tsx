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
import { LanguageSwitch, localised } from './language-switch.tsx';
import {
  applySearch,
  type CustomersSearch,
  clean,
  type ExpiriesSearch,
  flag,
  oneOf,
  type ResourceListSearch,
  type SetSearch,
  type SitesSearch,
  text,
  type UnitsSearch,
} from './list-search.ts';
import { m } from './paraglide/messages.js';
import { getLocale } from './paraglide/runtime.js';
import { ExpiriesPage } from './resources/expiries-page.tsx';
import { ImportPage } from './resources/import-page.tsx';
import { ListPage } from './resources/list-page.tsx';
import { ResourcePage } from './resources/resource-page.tsx';
import { followRowLinks } from './row-links.ts';
import { UnitPage, type UnitStart } from './units/unit-page.tsx';
import { UnitsPage } from './units/units-page.tsx';

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
  component: localised(() => (
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
  )),
  notFoundComponent: localised(() => (
    <div className="page not-found">
      <h1>{m.page_not_found_title()}</h1>
      <p>{m.page_not_found_text()}</p>
      <p>
        <Link to="/resources/$kind" params={{ kind: 'drivers' }}>
          {m.action_back_home()}
        </Link>
      </p>
    </div>
  )),
});

const count = (value: unknown) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

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
  validateSearch: (search: Record<string, unknown>): ExpiriesSearch =>
    clean<ExpiriesSearch>({
      kind: oneOf(search.kind, ['driver', 'power-unit', 'trailer'] as const),
      blocking: flag(search.blocking),
    }),
  component: localised(function Expiries() {
    const search = expiriesRoute.useSearch();
    const navigate = expiriesRoute.useNavigate();
    const setSearch: SetSearch<ExpiriesSearch> = (patch, options) =>
      navigate({
        search: (current) => applySearch(current, patch),
        replace: options?.replace === true,
      });
    return <ExpiriesPage search={search} setSearch={setSearch} />;
  }),
});

const unitsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/resources/units',
  validateSearch: (search: Record<string, unknown>): UnitsSearch =>
    clean<UnitsSearch>({
      at: text(search.at),
      q: text(search.q),
      filter: oneOf(search.filter, ['documents', 'no-driver'] as const),
    }),
  component: localised(function Units() {
    const search = unitsRoute.useSearch();
    const navigate = unitsRoute.useNavigate();
    const setSearch: SetSearch<UnitsSearch> = (patch, options) =>
      navigate({
        search: (current) => applySearch(current, patch),
        replace: options?.replace === true,
      });
    return <UnitsPage search={search} setSearch={setSearch} />;
  }),
});

const newUnitRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/resources/units/new',
  validateSearch: (search: Record<string, unknown>): UnitStart =>
    Object.fromEntries(
      (['start', 'powerUnit', 'trailer', 'driver'] as const).flatMap((key) => {
        const value = text(search[key]);
        return value ? [[key, value]] : [];
      }),
    ),
  component: localised(function NewUnit() {
    const initial = newUnitRoute.useSearch();
    return <UnitPage initial={initial} />;
  }),
});

const unitRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/resources/units/$id',
  component: localised(function Unit() {
    const { id } = unitRoute.useParams();
    return <UnitPage key={id} id={id} />;
  }),
});

const kindOf = (slug: string) => {
  const kind = kindFromSlug(slug);
  if (!kind) throw redirect({ to: '/resources/$kind', params: { kind: 'drivers' } });
  return kind;
};

type ListRouteSearch = ResourceListSearch & { imported?: number };

export const listRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/resources/$kind',
  validateSearch: (search: Record<string, unknown>): ListRouteSearch =>
    clean<ListRouteSearch>({
      imported: count(search.imported) || undefined,
      q: text(search.q),
      status: oneOf(search.status, ['expiring', 'expired'] as const),
      archived: flag(search.archived),
    }),
  component: localised(function List() {
    const { kind } = listRoute.useParams();
    const { imported, ...search } = listRoute.useSearch();
    const navigate = listRoute.useNavigate();
    const setSearch: SetSearch<ResourceListSearch> = (patch, options) =>
      navigate({
        search: (current) => applySearch<ListRouteSearch>(current, patch, ['imported']),
        replace: options?.replace === true,
      });
    return (
      <ListPage
        key={kind}
        kind={kindOf(kind)}
        imported={imported}
        search={search}
        setSearch={setSearch}
      />
    );
  }),
});

const newRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/resources/$kind/new',
  component: localised(function New() {
    const { kind } = newRoute.useParams();
    return <ResourcePage key={kind} kind={kindOf(kind)} />;
  }),
});

const importRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/resources/$kind/import',
  component: localised(function Import() {
    const { kind } = importRoute.useParams();
    return <ImportPage key={kind} kind={kindOf(kind)} />;
  }),
});

const resourceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/resources/$kind/$id',
  component: localised(function Resource() {
    const { kind, id } = resourceRoute.useParams();
    return <ResourcePage key={id} kind={kindOf(kind)} id={id} />;
  }),
});

type CustomersRouteSearch = CustomersSearch & { imported?: number };

const customersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers',
  validateSearch: (search: Record<string, unknown>): CustomersRouteSearch =>
    clean<CustomersRouteSearch>({
      imported: count(search.imported) || undefined,
      q: text(search.q),
      country: oneOf(search.country, ['france', 'abroad'] as const),
      archived: flag(search.archived),
    }),
  component: localised(function Customers() {
    const { imported, ...search } = customersRoute.useSearch();
    const navigate = customersRoute.useNavigate();
    const setSearch: SetSearch<CustomersSearch> = (patch, options) =>
      navigate({
        search: (current) => applySearch<CustomersRouteSearch>(current, patch, ['imported']),
        replace: options?.replace === true,
      });
    return <CustomersPage imported={imported} search={search} setSearch={setSearch} />;
  }),
});

const newCustomerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/new',
  component: localised(() => <CustomerPage />),
});

const customerImportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/import',
  component: localised(CustomerImportPage),
});

type SitesRouteSearch = SitesSearch & { imported?: number; notLocated?: number };

const sitesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/sites',
  validateSearch: (search: Record<string, unknown>): SitesRouteSearch => {
    const imported = count(search.imported) || undefined;
    return clean<SitesRouteSearch>({
      imported,
      notLocated: imported ? (count(search.notLocated) ?? 0) : undefined,
      q: text(search.q),
      filter: oneOf(search.filter, ['not-located', 'booking', 'protective-equipment'] as const),
      archived: flag(search.archived),
    });
  },
  component: localised(function Sites() {
    const { imported, notLocated, ...search } = sitesRoute.useSearch();
    const navigate = sitesRoute.useNavigate();
    const setSearch: SetSearch<SitesSearch> = (patch, options) =>
      navigate({
        search: (current) =>
          applySearch<SitesRouteSearch>(current, patch, ['imported', 'notLocated']),
        replace: options?.replace === true,
      });
    return (
      <SitesPage
        imported={imported ? { count: imported, notLocated: notLocated ?? 0 } : undefined}
        search={search}
        setSearch={setSearch}
      />
    );
  }),
});

const newSiteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/sites/new',
  validateSearch: (search: Record<string, unknown>): { customer?: string } =>
    typeof search.customer === 'string' ? { customer: search.customer } : {},
  component: localised(function NewSite() {
    const { customer } = newSiteRoute.useSearch();
    return <SitePage customerId={customer} />;
  }),
});

const siteImportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/sites/import',
  component: localised(SiteImportPage),
});

const siteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/sites/$id',
  component: localised(function Site() {
    const { id } = siteRoute.useParams();
    return <SitePage key={id} id={id} />;
  }),
});

const customerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/$id',
  component: localised(function Customer() {
    const { id } = customerRoute.useParams();
    return <CustomerPage key={id} id={id} />;
  }),
});

const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    expiriesRoute,
    unitsRoute,
    newUnitRoute,
    unitRoute,
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
