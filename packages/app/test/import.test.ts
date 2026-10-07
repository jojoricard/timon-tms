import { describe, expect, it } from 'vitest';
import {
  checkImport,
  createResource,
  importLimits,
  importResources,
  importTemplate,
  listResources,
} from '../src/index.ts';
import { memoryPorts } from './memory.ts';

const drivers = (count: number, line?: (n: number) => string) =>
  [
    'last_name;first_name;employee_number;licence_ce;cpc',
    ...Array.from(
      { length: count },
      (_, i) => line?.(i + 2) ?? `Driver${i + 1};Test;E${i + 1};15/03/2030;01/06/2029`,
    ),
  ].join('\n');

const trailers = (count: number) =>
  [
    'plate;kind;category;gvw_kg;body_type;roadworthiness',
    ...Array.from(
      { length: count },
      (_, i) => `SR-${5000 + i};semi-trailer;O4;35 000;curtainsider;15/04/2027`,
    ),
  ].join('\n');

describe('checkImport', () => {
  it('criterion 9: line 17 without a last name stops the import of 40 drivers', async () => {
    const { ports, resources } = memoryPorts();
    const csv = drivers(40, (line) =>
      line === 17
        ? ';Paul;E17;15/03/2030;01/06/2029'
        : `Name${line};Test;E${line};15/03/2030;01/06/2029`,
    );
    const check = await checkImport(ports, 'driver', csv);
    expect(check.ready).toBe(false);
    expect(check.summary).toMatchObject({ lines: 40, valid: 39, invalid: 1 });
    expect(check.rows.filter((r) => r.issues.length > 0)).toMatchObject([
      { line: 17, issues: [{ field: 'lastName', code: 'required' }] },
    ]);

    const result = await importResources(ports, 'driver', csv);
    expect(result).toMatchObject({ ok: false, check: { ready: false } });
    expect(resources).toHaveLength(0);
  });

  it('criterion 10: imports 40 valid trailers with their documents', async () => {
    const { ports } = memoryPorts();
    expect(await importResources(ports, 'trailer', trailers(40))).toEqual({
      ok: true,
      imported: 40,
    });
    const { resources } = await listResources(ports, { kind: 'trailer' });
    expect(resources).toHaveLength(40);
    expect(resources[0]?.documents.map((d) => d.type.code)).toEqual(['roadworthiness']);
  });

  it('reads French column names and values, with a BOM and commas', async () => {
    const { ports } = memoryPorts();
    const csv =
      '﻿Immatriculation,Type,Catégorie,PTAC (kg),Carrosserie,Contrôle technique\nRQ-0912,Remorque,O3,10000,Fourgon,07/12/2026';
    const check = await checkImport(ports, 'trailer', csv);
    expect(check).toMatchObject({ ready: true, summary: { valid: 1, documents: 1 } });
  });

  it('lists every error with its line: kind, category, date, duplicate, plate already in Timon', async () => {
    const { ports } = memoryPorts();
    await createResource(ports, {
      kind: 'trailer',
      plate: 'SR-4480',
      vehicleKind: 'semi-trailer',
      category: 'O4',
      gvwKg: 35_000,
      gcwKg: null,
      makeModel: null,
      bodyTypeId: null,
      tradeLabelId: null,
      capabilityIds: [],
    });
    const csv = [
      'plate;kind;category;gvw_kg;roadworthiness',
      'SR-4471;semi-trailer;O4;35000;15/04/2027',
      ';semi-trailer;O4;35000;11/06/2027',
      'SR-4478;semi-trailer;O2;3400;19/05/2027',
      'SR-4479;flying carpet;O4;35000;28/02/2027',
      'SR-4482;semi-trailer;O4;35000;31/02/2027',
      'sr 4471;semi-trailer;O4;35000;14/08/2027',
      'sr 4480;semi-trailer;O4;35000;29/10/2026',
    ].join('\n');
    const check = await checkImport(ports, 'trailer', csv);
    expect(
      check.rows
        .filter((r) => r.issues.length > 0)
        .map((r) => [r.line, r.issues.map((i) => i.code)]),
    ).toEqual([
      [3, ['required']],
      [4, ['category-not-allowed']],
      [5, ['unknown-value']],
      [6, ['invalid-date']],
      [7, ['plate-duplicated']],
      [8, ['plate-taken']],
    ]);
    expect(check.summary).toMatchObject({ lines: 7, valid: 1, invalid: 6, alreadyInTimon: 1 });
  });

  it('refuses a file over 1 MB or over 2,000 lines, and one without its required columns', async () => {
    const { ports } = memoryPorts();
    const big = `last_name;first_name\n${'x'.repeat(importLimits.maxBytes)}`;
    expect((await checkImport(ports, 'driver', big)).problem).toEqual({
      code: 'too-large',
      params: { maxBytes: 1_000_000 },
    });
    expect((await checkImport(ports, 'driver', drivers(2_001))).problem).toEqual({
      code: 'too-many-lines',
      params: { maxLines: 2_000 },
    });
    expect((await checkImport(ports, 'driver', drivers(2_000))).problem).toBeNull();
    expect((await checkImport(ports, 'trailer', 'plate;kind\nSR-1;semi-trailer')).problem).toEqual({
      code: 'missing-columns',
      params: { fields: ['category', 'gvwKg'] },
    });
    expect((await checkImport(ports, 'trailer', 'plate;kind;category;gvw_kg\n\n')).problem).toEqual(
      {
        code: 'empty',
      },
    );
  });

  it('gives a template in each language', () => {
    expect(importTemplate('trailer', 'en')).toMatch(/^plate;kind;category;gvw_kg;/);
    expect(importTemplate('trailer', 'fr')).toMatch(/^immatriculation;type;categorie;ptac_kg;/);
  });
});
