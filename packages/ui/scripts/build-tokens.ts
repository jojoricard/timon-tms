// Turns docs/design/tokens.json, the design system's source, into CSS custom properties.
// The output is not committed: it is rebuilt by `pnpm generate`.
import { readFileSync, writeFileSync } from 'node:fs';

type Themed = string | { light: string; dark: string };
type Style = {
  name: string;
  family?: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: number;
  letterSpacing?: string;
};
type Tokens = {
  color: { tokens: { name: string; value: Themed }[] };
  type: { families: Record<string, string>; groups: { family: string; styles: Style[] }[] };
  spacing: { tokens: { name: string; value: string }[] };
  radius: { tokens: { name: string; value: string }[] };
  size: { tokens: { name: string; value: string }[] };
  shadow: { tokens: { name: string; value: Themed }[] };
};

const tokens = JSON.parse(
  readFileSync(new URL('../../../docs/design/tokens.json', import.meta.url), 'utf8'),
) as Tokens;

const light: string[] = [];
const dark: string[] = [];
const themed = (name: string, value: Themed) => {
  light.push(`  ${name}: ${typeof value === 'string' ? value : value.light};`);
  if (typeof value !== 'string') dark.push(`  ${name}: ${value.dark};`);
};

for (const { name, value } of tokens.color.tokens) themed(`--color-${name}`, value);
for (const { name, value } of tokens.shadow.tokens) themed(`--${name}`, value);

const plain: string[] = [];
for (const [name, family] of Object.entries(tokens.type.families)) {
  plain.push(`  --font-${name}: ${family};`);
}
for (const group of tokens.type.groups) {
  for (const s of group.styles) {
    const family = s.family ?? group.family;
    plain.push(
      `  --type-${s.name}: ${s.fontWeight} ${s.fontSize}/${s.lineHeight} var(--font-${family});`,
    );
    plain.push(`  --type-${s.name}-tracking: ${s.letterSpacing ?? 'normal'};`);
  }
}
for (const list of [tokens.spacing, tokens.radius, tokens.size]) {
  for (const { name, value } of list.tokens) plain.push(`  --${name}: ${value};`);
}

const block = (selector: string, lines: string[]) => `${selector} {\n${lines.join('\n')}\n}\n`;

writeFileSync(
  new URL('../src/tokens.css', import.meta.url),
  [
    '/* Generated from docs/design/tokens.json by scripts/build-tokens.ts. Do not edit. */\n',
    block(':root', [...plain, ...light, '  color-scheme: light;']),
    `@media (prefers-color-scheme: dark) {\n${block(':root:not([data-theme="light"])', [...dark, '  color-scheme: dark;'])}}\n`,
    block(':root[data-theme="dark"]', [...dark, '  color-scheme: dark;']),
  ].join('\n'),
);
