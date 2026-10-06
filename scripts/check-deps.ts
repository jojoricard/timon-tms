// Enforces the dependency direction of ADR-002 and keeps Node out of the code that must also
// run in a browser. Reads package manifests and the import statements under each src/ folder.
import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// Internal packages each package may import (ADR-002, "May depend on").
const allowed: Record<string, string[]> = {
  '@timon/domain': [],
  '@timon/app': ['@timon/domain'],
  '@timon/db': ['@timon/app', '@timon/domain'],
  '@timon/http': ['@timon/app', '@timon/domain'],
  '@timon/ui': [],
  // The web app reads the API's types through the typed client, never its code.
  '@timon/web': ['@timon/ui', '@timon/domain', 'type:@timon/http'],
  '@timon/api': ['@timon/http', '@timon/db'],
  // The demo shell mounts the web app once its service worker answers /api.
  '@timon/demo': ['@timon/http', '@timon/db', '@timon/web'],
};

// Only the Node entry may use Node; db's test support is never bundled.
const nodeAllowed = new Set(['apps/api/src', 'packages/db/src/testing.ts']);
// The domain is pure: relative imports and the Temporal polyfill, nothing else.
const domainImports = new Set(['temporal-polyfill']);

const builtins = new Set(builtinModules);
const importPattern =
  /(?:^|\n)\s*(import|export)(\s+type)?[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;

const errors: string[] = [];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'paraglide' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

for (const group of ['packages', 'apps']) {
  for (const name of readdirSync(join(root, group))) {
    const dir = join(root, group, name);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const pkg: string = manifest.name;
    const rules = allowed[pkg];
    if (!rules) {
      errors.push(`${pkg}: not listed in scripts/check-deps.ts`);
      continue;
    }
    const valueDeps = rules.filter((r) => !r.startsWith('type:'));
    const typeDeps = rules.filter((r) => r.startsWith('type:')).map((r) => r.slice(5));

    const declared = { ...manifest.dependencies, ...manifest.devDependencies };
    for (const dep of Object.keys(declared).filter((d) => d.startsWith('@timon/'))) {
      if (!valueDeps.includes(dep) && !typeDeps.includes(dep)) {
        errors.push(`${pkg}: package.json depends on ${dep}, which ADR-002 does not allow`);
      }
    }

    for (const file of sourceFiles(join(dir, 'src'))) {
      const path = relative(root, file).split(sep).join('/');
      const mayUseNode = [...nodeAllowed].some((p) => path === p || path.startsWith(`${p}/`));
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(importPattern)) {
        const typeOnly = match[2] !== undefined;
        const spec = match[3] ?? match[4] ?? match[5] ?? '';
        if (spec.startsWith('.')) continue;
        const internal = spec.match(/^@timon\/[^/]+/)?.[0];
        if (internal && internal !== pkg) {
          const ok = valueDeps.includes(internal) || (typeOnly && typeDeps.includes(internal));
          if (!ok) errors.push(`${path}: imports ${spec}${typeOnly ? ' (type)' : ''}`);
        }
        const bare = spec.replace(/^node:/, '').split('/')[0] ?? '';
        if (!mayUseNode && (spec.startsWith('node:') || builtins.has(bare) || spec === 'pg')) {
          errors.push(`${path}: imports ${spec}, which does not run in a browser`);
        }
        if (pkg === '@timon/domain' && !domainImports.has(spec)) {
          errors.push(`${path}: imports ${spec}; the domain only imports the Temporal polyfill`);
        }
      }
      if (!mayUseNode && /\bprocess\.(env|argv|exit)\b/.test(text)) {
        errors.push(`${path}: uses process, which does not exist in a browser`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`Dependency rules broken:\n${errors.map((e) => `  ${e}`).join('\n')}`);
  process.exit(1);
}
console.log('Dependency direction: OK');
