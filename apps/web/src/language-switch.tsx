import { m } from './paraglide/messages.js';
import { getLocale, locales, setLocale } from './paraglide/runtime.js';

export function LanguageSwitch() {
  return (
    <select
      aria-label={m.language()}
      value={getLocale()}
      onChange={(event) => setLocale(event.target.value as (typeof locales)[number])}
    >
      {locales.map((locale) => (
        <option key={locale} value={locale}>
          {locale.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
