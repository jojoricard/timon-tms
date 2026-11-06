import { describe, expect, it } from 'vitest';
import {
  checkImport,
  customerImportGuide,
  customerTemplate,
  importTemplate,
  resourceImportGuide,
  siteImportGuide,
  siteTemplate,
} from '../src/index.ts';
import { memoryPorts } from './memory.ts';

// SPEC-001, Import screen: the template, the formats it accepts and the values of each column.

const bom = '﻿';

describe('templates', () => {
  it('start with a byte order mark, so that spreadsheet software reads accents in UTF-8', () => {
    expect(importTemplate('driver', 'fr').startsWith(bom)).toBe(true);
    expect(importTemplate('trailer', 'en').startsWith(bom)).toBe(true);
    expect(customerTemplate('fr').startsWith(bom)).toBe(true);
    expect(siteTemplate('en').startsWith(bom)).toBe(true);
  });

  it('give drivers a protective equipment column', () => {
    expect(importTemplate('driver', 'en')).toContain(';protective_equipment');
    expect(importTemplate('driver', 'fr')).toContain(';epi');
  });
});

describe('formats', () => {
  it('reads a file separated by tabs, with ISO dates', async () => {
    const { ports } = memoryPorts();
    const csv = 'last_name\tfirst_name\tlicence_ce\nBenali\tKarim\t2030-03-15';
    expect(await checkImport(ports, 'driver', csv)).toMatchObject({
      ready: true,
      summary: { valid: 1, documents: 1 },
    });
  });

  it('reads the protective equipment of a driver, in English or French', async () => {
    const { ports } = memoryPorts();
    const csv = ['nom;prenom;epi', 'Benali;Karim;chaussures | gilet', 'Morel;Yanis;helmet'].join(
      '\n',
    );
    const check = await checkImport(ports, 'driver', csv);
    expect(check.ready).toBe(true);
    const wrong = await checkImport(ports, 'driver', 'nom;prenom;epi\nBenali;Karim;parapluie');
    expect(wrong.rows[0]?.issues).toEqual([
      { field: 'protectiveEquipmentIds', code: 'unknown-value', params: { value: 'parapluie' } },
    ]);
  });
});

describe('the accepted values of each column', () => {
  it('lists the kinds and categories of a trailer, in the language of the screen', async () => {
    const { ports } = memoryPorts();
    const lists = await ports.referenceLists.get();
    const guide = resourceImportGuide('trailer', 'fr', lists);
    const column = (field: string) => guide.find((c) => c.field === field);
    expect(column('plate')).toEqual({
      field: 'plate',
      header: 'immatriculation',
      required: true,
      accepts: { kind: 'text' },
    });
    expect(column('vehicleKind')?.accepts).toEqual({
      kind: 'one-of',
      values: [
        ['semi trailer', 'semi remorque', 'semi'],
        ['drawbar trailer', 'drawbar', 'remorque'],
      ],
    });
    expect(column('category')?.accepts).toEqual({
      kind: 'one-of',
      values: [['O1'], ['O2'], ['O3'], ['O4']],
    });
    expect(column('gvwKg')?.accepts).toEqual({ kind: 'weight' });
    expect(column('document:roadworthiness')?.accepts).toEqual({ kind: 'date' });
    expect(column('capabilityIds')?.accepts.kind).toBe('list-of');
  });

  it('lists the protective equipment of drivers and sites, the countries of customers', async () => {
    const { ports } = memoryPorts();
    const lists = await ports.referenceLists.get();
    const driverEquipment = resourceImportGuide('driver', 'en', lists).find(
      (c) => c.field === 'protectiveEquipmentIds',
    );
    expect(driverEquipment).toMatchObject({
      header: 'protective_equipment',
      accepts: { kind: 'list-of' },
    });
    const site = siteImportGuide('fr', lists);
    expect(site.find((c) => c.field === 'protectiveEquipmentIds')?.accepts).toEqual(
      driverEquipment?.accepts,
    );
    expect(site.find((c) => c.field === 'openings.1')).toMatchObject({
      header: 'lundi',
      accepts: { kind: 'hours' },
    });
    expect(site.find((c) => c.field === 'loadingDock')?.accepts).toEqual({ kind: 'yes-no' });
    expect(customerImportGuide('en').find((c) => c.field === 'country')?.accepts).toEqual({
      kind: 'country',
    });
  });
});
