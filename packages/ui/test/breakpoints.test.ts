import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Media and container queries cannot read custom properties, so the stylesheets write breakpoint
// values themselves. This keeps them to the breakpoints of the design tokens: viewport values in
// media queries, container values in container queries, nothing else.

const root = new URL('../../../', import.meta.url);
const tokens = JSON.parse(readFileSync(new URL('docs/design/tokens.json', root), 'utf8')) as {
  breakpoint: { tokens: { name: string; value: string; query: 'viewport' | 'container' }[] };
};
const allowed = (query: 'viewport' | 'container') =>
  tokens.breakpoint.tokens.filter((t) => t.query === query).map((t) => t.value);

const stylesheets = ['packages/ui/src', 'apps/web/src'].flatMap((dir) =>
  readdirSync(new URL(dir, root), { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.css') && !file.endsWith('tokens.css'))
    .map((file) => join(dir, file)),
);

const queries = stylesheets.flatMap((file) =>
  readFileSync(new URL(file.replaceAll('\\', '/'), root), 'utf8')
    .split('\n')
    .flatMap((line, index) => {
      const query = line.match(/@(media|container)\b([^{]*)/);
      if (!query) return [];
      const values = [...(query[2] ?? '').matchAll(/(\d+(?:\.\d+)?)(px|em|rem)\b/g)].map(
        (m) => `${m[1]}${m[2]}`,
      );
      return values.map((value) => ({
        at: `${file}:${index + 1}`,
        kind: query[1] === 'media' ? ('viewport' as const) : ('container' as const),
        value,
      }));
    }),
);

describe('breakpoints', () => {
  it('finds the queries of the stylesheets', () => {
    expect(queries.length).toBeGreaterThan(0);
  });

  it('uses only the breakpoints of the design tokens', () => {
    const strays = queries.filter((q) => !allowed(q.kind).includes(q.value));
    expect(strays.map((q) => `${q.at}: ${q.value} is not a ${q.kind} breakpoint`)).toEqual([]);
  });
});
