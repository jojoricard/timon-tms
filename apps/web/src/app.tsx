import '@timon/ui/styles.css';
import './app.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { Banner } from '@timon/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BookingsPage } from './bookings-page.tsx';
import { LanguageSwitch } from './language-switch.tsx';
import { m } from './paraglide/messages.js';
import { getLocale } from './paraglide/runtime.js';

const rootRoute = createRootRoute({
  component: () => (
    <div className="layout">
      <header className="appbar">
        <span className="wordmark">Timon</span>
        <LanguageSwitch />
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  ),
});

const bookingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: BookingsPage,
});

const router = createRouter({ routeTree: rootRoute.addChildren([bookingsRoute]) });

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
