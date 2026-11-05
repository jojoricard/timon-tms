import { type ReactNode, useSyncExternalStore } from 'react';
import { m } from './paraglide/messages.js';
import { getLocale, locales, setLocale } from './paraglide/runtime.js';

type Locale = (typeof locales)[number];

/*
 * The language changes in place. Paraglide reloads the page by default, which loses a form being
 * filled or an import being checked. Here each screen subscribes to the language and renders
 * again when it changes, its state kept: the router keeps its screens from rendering on their
 * own, so the subscription is on each of them, through `localised`.
 */

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function changeLocale(locale: Locale) {
  setLocale(locale, { reload: false });
  document.documentElement.lang = locale;
  for (const listener of listeners) listener();
}

/** The current language; the component renders again when it changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale);
}

/** A screen that renders again in the new language, keeping its state. */
export function localised<P extends object>(
  Screen: (props: P) => ReactNode,
): (props: P) => ReactNode {
  return function Localised(props: P) {
    useLocale();
    return <Screen {...props} />;
  };
}

export function LanguageSwitch() {
  const locale = useLocale();
  return (
    <select
      aria-label={m.language()}
      value={locale}
      onChange={(event) => changeLocale(event.target.value as Locale)}
    >
      {locales.map((locale) => (
        <option key={locale} value={locale}>
          {locale.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
