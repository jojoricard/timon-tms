import { DocumentTypeTakenError, type NewResource, PlateTakenError, type Ports } from '@timon/app';
import { Temporal, type Vehicle } from '@timon/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRepositories } from '../src/index.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';

// The repositories on a real database, and the constraints that hold even when the
// application's own checks are bypassed.

let database: TestDatabase;
let ports: Ports;

beforeAll(async () => {
  database = await createTestDatabase();
  ports = createRepositories(database.db);
});

afterAll(() => database.close());

const vehicle = (plate: string, changes: Partial<Vehicle> = {}): NewResource => ({
  details: {
    kind: 'power-unit',
    plate,
    vehicleKind: 'tractor',
    category: 'N3',
    gvwKg: 19_000,
    gcwKg: 44_000,
    makeModel: null,
    bodyTypeId: null,
    tradeLabelId: null,
    capabilityIds: [],
    ...changes,
  } as Vehicle,
  documents: [],
});

const lists = () => ports.referenceLists.get();
const typeId = async (code: string) =>
  (await lists()).documentTypes.find((t) => t.code === code)?.id ?? '';

describe('reference lists', () => {
  it('holds the lists of SPEC-001', async () => {
    const { documentTypes, bodyTypes, tradeLabels, capabilities } = await lists();
    expect(documentTypes.map((t) => [t.code, t.blocking, t.warnDays])).toEqual([
      ['licence-b', true, 60],
      ['licence-c1', true, 60],
      ['licence-c', true, 60],
      ['licence-ce', true, 60],
      ['licence-c1e', true, 60],
      ['cpc', true, 90],
      ['driver-card', true, 30],
      ['adr-certificate', true, 90],
      ['health-check', false, 30],
      ['roadworthiness', true, 30],
      ['tachograph', true, 30],
      ['atp', true, 60],
      ['adr-approval', true, 30],
    ]);
    expect(bodyTypes.map((b) => b.code)).toEqual([
      'curtainsider',
      'box',
      'refrigerated',
      'flatbed',
      'tipper',
      'tanker',
    ]);
    expect(tradeLabels.map((l) => l.name)).toEqual(['PL', 'PP', 'GP']);
    expect(capabilities).toHaveLength(4);
  });
});

describe('resources', () => {
  it('stores a vehicle with its capabilities and documents', async () => {
    const { capabilities, bodyTypes } = await lists();
    const created = await ports.resources.create({
      details: vehicle('GH-012-IJ', {
        vehicleKind: 'rigid-truck',
        gcwKg: null,
        bodyTypeId: bodyTypes[2]?.id ?? null,
        capabilityIds: [capabilities[3]?.id ?? ''],
      }).details,
      documents: [
        {
          documentTypeId: await typeId('atp'),
          reference: 'ATP-1',
          issuedOn: Temporal.PlainDate.from('2020-11-24'),
          expiresOn: Temporal.PlainDate.from('2026-11-24'),
        },
      ],
    });
    const read = await ports.resources.get(created.id);
    expect(read).toMatchObject({ plate: 'GH-012-IJ', capabilityIds: [capabilities[3]?.id] });
    expect(read?.documents.map((d) => [d.reference, d.expiresOn.toString()])).toEqual([
      ['ATP-1', '2026-11-24'],
    ]);
  });

  it('criterion 5: refuses a second active "ab 123 cd", even without the application check', async () => {
    await ports.resources.create(vehicle('AB-123-CD'));
    await expect(ports.resources.create(vehicle('ab 123 cd'))).rejects.toBeInstanceOf(
      PlateTakenError,
    );
    expect(await ports.resources.findActiveByPlate('AB123CD')).toMatchObject({
      plate: 'AB-123-CD',
    });
  });

  it('frees the plate of an archived vehicle and refuses to restore it once reused', async () => {
    const old = await ports.resources.create(vehicle('EF-789-GH'));
    await ports.resources.setArchived(old.id, true);
    await ports.resources.create(vehicle('EF 789 GH'));
    await expect(ports.resources.setArchived(old.id, false)).rejects.toBeInstanceOf(
      PlateTakenError,
    );
  });

  it('imports all or nothing', async () => {
    await expect(
      ports.resources.createMany([vehicle('QR-678-ST'), vehicle('qr 678 st')]),
    ).rejects.toBeInstanceOf(PlateTakenError);
    expect(await ports.resources.findActiveByPlate('QR678ST')).toBeUndefined();
  });

  it('criteria 6 and 7: the database refuses a light van in N3 and a tractor with a body type', async () => {
    const subsidiary = '10000000-0000-4000-8000-000000000002';
    const box = (await lists()).bodyTypes[1]?.id;
    await expect(
      database.db.execute(
        sql`insert into resource (subsidiary_id, kind, plate, plate_key, vehicle_kind, category, gvw_kg)
            values (${subsidiary}, 'power-unit', 'FG-204-HJ', 'FG204HJ', 'light-van', 'N3', 3500)`,
      ),
    ).rejects.toThrow();
    await expect(
      database.db.execute(
        sql`insert into resource (subsidiary_id, kind, plate, plate_key, vehicle_kind, category, gvw_kg, body_type_id)
            values (${subsidiary}, 'power-unit', 'KL-678-MN', 'KL678MN', 'tractor', 'N3', 19000, ${box})`,
      ),
    ).rejects.toThrow();
  });
});

describe('documents', () => {
  it('holds one document per type and resource', async () => {
    const tractor = await ports.resources.create(vehicle('CD-456-EF'));
    const tachograph = {
      documentTypeId: await typeId('tachograph'),
      reference: 'TACH-88213',
      issuedOn: null,
      expiresOn: Temporal.PlainDate.from('2026-10-22'),
    };
    const added = await ports.documents.add(tractor.id, tachograph);
    await expect(ports.documents.add(tractor.id, tachograph)).rejects.toBeInstanceOf(
      DocumentTypeTakenError,
    );
    const renewed = await ports.documents.update(added.id, {
      ...tachograph,
      expiresOn: Temporal.PlainDate.from('2028-10-22'),
    });
    expect(renewed?.expiresOn.toString()).toBe('2028-10-22');
    expect(await ports.documents.remove(added.id)).toBe(true);
    expect((await ports.resources.get(tractor.id))?.documents).toEqual([]);
  });
});
