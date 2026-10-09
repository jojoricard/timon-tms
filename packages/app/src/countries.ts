import { countries, isCountry } from '@timon/domain';
import { simplify } from './csv.ts';

// A country in a file may be written as a code ("IT") or a name in English or French
// ("Italy", "Italie"); the names come from the runtime, in Node and in browsers alike.
const names = new Map<string, string>();
for (const language of ['en', 'fr']) {
  const display = new Intl.DisplayNames([language], { type: 'region' });
  for (const code of countries) {
    const name = display.of(code);
    if (name) names.set(simplify(name), code);
  }
}

/** The country code of a cell, France when empty, undefined when not recognised. */
export function parseCountry(value: string): string | undefined {
  const text = value.trim();
  if (text === '') return 'FR';
  if (isCountry(text.toUpperCase())) return text.toUpperCase();
  return names.get(simplify(text));
}
