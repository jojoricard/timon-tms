// Paraglide falls back to the base locale when a message is missing, so a forgotten
// translation would not break the build. This check does: every locale has every message.
import { readFileSync } from 'node:fs';

const project = new URL('../apps/web/', import.meta.url);
const settings = JSON.parse(readFileSync(new URL('project.inlang/settings.json', project), 'utf8'));
const locales: string[] = settings.locales;

const messages = new Map<string, Record<string, unknown>>(
  locales.map((locale) => [
    locale,
    JSON.parse(readFileSync(new URL(`messages/${locale}.json`, project), 'utf8')),
  ]),
);

const keys = new Set([...messages.values()].flatMap((m) => Object.keys(m)));
keys.delete('$schema');

const errors: string[] = [];
for (const [locale, entries] of messages) {
  for (const key of keys) {
    const value = entries[key];
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`${locale}: missing or empty message "${key}"`);
    }
  }
}

// Same variables on both sides: a translation must not drop or rename one.
const variables = (text: unknown) =>
  [...String(text).matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');
for (const key of keys) {
  const [first, ...others] = locales;
  for (const locale of others) {
    const a = messages.get(first ?? '')?.[key];
    const b = messages.get(locale)?.[key];
    if (a !== undefined && b !== undefined && variables(a) !== variables(b)) {
      errors.push(
        `${locale}: message "${key}" uses {${variables(b)}}, ${first} uses {${variables(a)}}`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error(`Interface messages incomplete:\n${errors.map((e) => `  ${e}`).join('\n')}`);
  process.exit(1);
}
console.log(`Interface messages: ${keys.size} in ${locales.join(', ')}, complete`);
