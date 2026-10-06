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
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BookingsPage } from './bookings-page.tsx';
import { LanguageSwitch } from './language-switch.tsx';
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
  document.documentElement.lang = getLocale();
  createRoot(element).render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
