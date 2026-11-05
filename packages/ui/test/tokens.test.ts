import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A token may name another one, as `{petrol}`. The build resolves the reference; left as it is,
// the custom property would make every declaration that reads it invalid, as the focus ring was.

const css = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8');
const declarations = [...css.matchAll(/^\s*(--[\w-]+):\s*([^;]*);/gm)].map(([, name, value]) => ({
  name,
  value,
}));

describe('generated tokens', () => {
  it('declares custom properties', () => {
    expect(declarations.length).toBeGreaterThan(50);
  });

  it('leaves no token reference in a value', () => {
    const unresolved = declarations.filter(({ value }) => /[{}]/.test(value ?? ''));
    expect(unresolved).toEqual([]);
  });

  it('gives the focus ring the colour of petrol, in each theme', () => {
    const values = (name: string) =>
      declarations.filter((d) => d.name === name).map((d) => d.value);
    expect(values('--color-focus')).toEqual(values('--color-petrol'));
  });
});
