import type {
  ContactDetails,
  CustomerDetails,
  OpenPeriod,
  Period,
  Resource,
  ResourceBooking,
  ResourceDetails,
  ResourceKind,
  SiteDetails,
  Temporal,
} from '@timon/domain';
import type { Geocoder } from './geocoding.ts';

export type NewBooking = Omit<ResourceBooking, 'id'>;

/** Raised by a repository when the database rejects a booking that overlaps another. */
export class BookingOverlapError extends Error {
  override readonly name = 'BookingOverlapError';
}

/** Raised by a repository when the database finds a resource in two units at once (rule 4). */
export class UnitOverlapError extends Error {
  override readonly name = 'UnitOverlapError';
}

/** Raised by a repository when the database finds the plate on another active resource. */
export class PlateTakenError extends Error {
  override readonly name = 'PlateTakenError';
}

/** Raised by a repository when another driver, archived or not, has the employee number. */
export class EmployeeNumberTakenError extends Error {
  override readonly name = 'EmployeeNumberTakenError';
}

/** Raised by a repository when another customer, archived or not, has the code (rule 1). */
export class CustomerCodeTakenError extends Error {
  override readonly name = 'CustomerCodeTakenError';
}

/** Raised by a repository when another active customer has the SIRET (rule 1). */
export class SiretTakenError extends Error {
  override readonly name = 'SiretTakenError';
}

/** Raised by a repository when two opening ranges of one day overlap (rule 4). */
export class OpeningOverlapError extends Error {
  override readonly name = 'OpeningOverlapError';
}

/**
 * Raised by a repository when a write names a version that is no longer current (ADR-005):
 * someone else changed the record since it was read. Carries the current version.
 */
export class StaleVersionError extends Error {
  override readonly name = 'StaleVersionError';
  readonly version: number;

  constructor(version: number) {
    super(`The record is at version ${version}`);
    this.version = version;
  }
}

/** Raised by a repository when the resource already holds a document of that type. */
export class DocumentTypeTakenError extends Error {
  override readonly name = 'DocumentTypeTakenError';
}

/**
 * An entry of a company list. Entries Timon provides have a `code` the interface translates;
 * entries a haulier adds have a `name`, shown as typed.
 */
export type ListItem = {
  readonly id: string;
  readonly code: string | null;
  readonly name: string | null;
};

export type DocumentType = ListItem & {
  readonly appliesTo: readonly ResourceKind[];
  readonly blocking: boolean;
  readonly warnDays: number;
};

export type ReferenceLists = {
  readonly documentTypes: readonly DocumentType[];
  readonly bodyTypes: readonly ListItem[];
  readonly tradeLabels: readonly ListItem[];
  readonly capabilities: readonly ListItem[];
  readonly protectiveEquipment: readonly ListItem[];
};

export type NewDocument = {
  readonly documentTypeId: string;
  readonly reference: string | null;
  readonly issuedOn: Temporal.PlainDate | null;
  readonly expiresOn: Temporal.PlainDate;
};

export type StoredDocument = NewDocument & {
  readonly id: string;
  readonly resourceId: string;
  /** ADR-005: its own, apart from the resource's. */
  readonly version: number;
};

export type StoredResource = Resource & {
  /** Rule 7 of SPEC-001; one subsidiary for now (#14). */
  readonly subsidiaryId: string;
  readonly version: number;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
  readonly documents: readonly StoredDocument[];
};

export type NewResource = {
  readonly details: ResourceDetails;
  readonly documents: readonly NewDocument[];
};

export interface ResourceRepository {
  list(filter: { kind?: ResourceKind; includeArchived: boolean }): Promise<StoredResource[]>;
  get(id: string): Promise<StoredResource | undefined>;
  /** The active resource with this plate key, other than `exceptId`. */
  findActiveByPlate(plateKey: string, exceptId?: string): Promise<StoredResource | undefined>;
  /**
   * The driver, archived or not, with this employee number compared without case, other than
   * `exceptId` (SPEC-001 rule 9).
   */
  findDriverByEmployeeNumber(
    employeeNumber: string,
    exceptId?: string,
  ): Promise<StoredResource | undefined>;
  /** @throws PlateTakenError, EmployeeNumberTakenError */
  create(resource: NewResource): Promise<StoredResource>;
  /** All or nothing, in one transaction. @throws PlateTakenError, EmployeeNumberTakenError */
  createMany(resources: readonly NewResource[]): Promise<number>;
  /** @throws StaleVersionError, PlateTakenError, EmployeeNumberTakenError */
  update(
    id: string,
    version: number,
    details: ResourceDetails,
  ): Promise<StoredResource | undefined>;
  /**
   * @throws StaleVersionError; PlateTakenError when restoring a plate another active resource
   * now uses.
   */
  setArchived(id: string, version: number, archived: boolean): Promise<StoredResource | undefined>;
}

export interface DocumentRepository {
  get(id: string): Promise<StoredDocument | undefined>;
  /** @throws DocumentTypeTakenError */
  add(resourceId: string, document: NewDocument): Promise<StoredDocument>;
  /** @throws StaleVersionError, DocumentTypeTakenError */
  update(id: string, version: number, document: NewDocument): Promise<StoredDocument | undefined>;
  /** @throws StaleVersionError */
  remove(id: string, version: number): Promise<boolean>;
}

export interface ReferenceListRepository {
  get(): Promise<ReferenceLists>;
}

export interface BookingRepository {
  listByResource(resourceId: string): Promise<ResourceBooking[]>;
  listOverlapping(resourceId: string, period: Period): Promise<ResourceBooking[]>;
  /** @throws BookingOverlapError when the period overlaps another booking of the resource. */
  insert(booking: NewBooking): Promise<ResourceBooking>;
}

/** The members of a unit: a power unit, and a driver or a trailer or both. */
export type UnitMembers = {
  readonly powerUnitId: string;
  readonly trailerId: string | null;
  readonly driverId: string | null;
};

export type NewUnit = UnitMembers & {
  /** Given by the dispatcher, e.g. "Unit 5"; otherwise the unit goes by its driver or plate. */
  readonly name: string | null;
  readonly period: OpenPeriod;
  /** The unit this one continues after a change of driver or trailer. */
  readonly previousUnitId: string | null;
};

export type StoredUnit = NewUnit & { readonly id: string; readonly version: number };

export interface UnitRepository {
  get(id: string): Promise<StoredUnit | undefined>;
  /** The units whose period contains the instant. */
  listAt(instant: Temporal.Instant): Promise<StoredUnit[]>;
  /** The units whose period overlaps `period`, other than `exceptId`. */
  listOverlapping(period: OpenPeriod, exceptId?: string): Promise<StoredUnit[]>;
  /** The units of a resource, latest start first. */
  listByResource(resourceId: string): Promise<StoredUnit[]>;
  /** @throws UnitOverlapError */
  create(unit: NewUnit): Promise<StoredUnit>;
  /** Members, name and period replaced. @throws StaleVersionError, UnitOverlapError */
  replace(id: string, version: number, unit: NewUnit): Promise<StoredUnit | undefined>;
  /** @throws StaleVersionError */
  remove(id: string, version: number): Promise<boolean>;
  /** @throws StaleVersionError, UnitOverlapError */
  setEnd(id: string, version: number, end: Temporal.Instant): Promise<StoredUnit | undefined>;
  /**
   * In one transaction, ends the unit when `next` starts, then creates `next` (rule 6). The
   * version is the ended unit's.
   * @throws StaleVersionError, UnitOverlapError
   */
  change(
    id: string,
    version: number,
    next: NewUnit,
  ): Promise<{ ended: StoredUnit; started: StoredUnit }>;
}

export type ContactInput = ContactDetails & { readonly id?: string | undefined };
export type StoredContact = ContactDetails & { readonly id: string };

export type CustomerInput = Omit<CustomerDetails, 'contacts'> & {
  readonly contacts: readonly ContactInput[];
};

export type StoredCustomer = Omit<CustomerDetails, 'contacts'> & {
  readonly id: string;
  readonly archived: boolean;
  /** ADR-005: contacts and usual sites are saved under it. */
  readonly version: number;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
  readonly contacts: readonly StoredContact[];
};

export interface CustomerRepository {
  list(filter: { includeArchived: boolean }): Promise<StoredCustomer[]>;
  get(id: string): Promise<StoredCustomer | undefined>;
  /** Archived customers included: a code is never reused (rule 1). */
  findByCode(code: string, exceptId?: string): Promise<StoredCustomer | undefined>;
  findActiveBySiret(siret: string, exceptId?: string): Promise<StoredCustomer | undefined>;
  /** @throws CustomerCodeTakenError, SiretTakenError */
  create(customer: CustomerInput): Promise<StoredCustomer>;
  /** All or nothing, in one transaction. @throws CustomerCodeTakenError, SiretTakenError */
  createMany(customers: readonly CustomerInput[]): Promise<number>;
  /**
   * Contacts left out of `customer.contacts` are deleted (rule 3); the usual sites are replaced.
   * @throws StaleVersionError, CustomerCodeTakenError, SiretTakenError
   */
  update(id: string, version: number, customer: CustomerInput): Promise<StoredCustomer | undefined>;
  /**
   * @throws StaleVersionError; SiretTakenError when restoring a SIRET another active customer
   * now has.
   */
  setArchived(id: string, version: number, archived: boolean): Promise<StoredCustomer | undefined>;
}

export type SiteRecord = SiteDetails & { readonly timeZone: string };

export type StoredSite = SiteRecord & {
  readonly id: string;
  readonly archived: boolean;
  readonly version: number;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
  /** The customers, archived or not, that list it among their usual sites. */
  readonly customerIds: readonly string[];
};

export interface SiteRepository {
  list(filter: { includeArchived: boolean }): Promise<StoredSite[]>;
  get(id: string): Promise<StoredSite | undefined>;
  /** @throws OpeningOverlapError */
  create(site: SiteRecord): Promise<StoredSite>;
  /** All or nothing, in one transaction. */
  createMany(sites: readonly SiteRecord[]): Promise<number>;
  /** @throws StaleVersionError, OpeningOverlapError */
  update(id: string, version: number, site: SiteRecord): Promise<StoredSite | undefined>;
  /** @throws StaleVersionError */
  setArchived(id: string, version: number, archived: boolean): Promise<StoredSite | undefined>;
}

/** The current time; tests fix it. */
export interface Clock {
  now(): Temporal.Instant;
}

export type Ports = {
  readonly resources: ResourceRepository;
  readonly documents: DocumentRepository;
  readonly referenceLists: ReferenceListRepository;
  readonly bookings: BookingRepository;
  readonly units: UnitRepository;
  readonly customers: CustomerRepository;
  readonly sites: SiteRepository;
  readonly geocoder: Geocoder;
  readonly clock: Clock;
};
