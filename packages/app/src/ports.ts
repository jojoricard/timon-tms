import type {
  Period,
  Resource,
  ResourceBooking,
  ResourceDetails,
  ResourceKind,
  Temporal,
} from '@timon/domain';

export type NewBooking = Omit<ResourceBooking, 'id'>;

/** Raised by a repository when the database rejects a booking that overlaps another. */
export class BookingOverlapError extends Error {
  override readonly name = 'BookingOverlapError';
}

/** Raised by a repository when the database finds the plate on another active resource. */
export class PlateTakenError extends Error {
  override readonly name = 'PlateTakenError';
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
};

export type StoredResource = Resource & {
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
  /** @throws PlateTakenError */
  create(resource: NewResource): Promise<StoredResource>;
  /** All or nothing, in one transaction. @throws PlateTakenError */
  createMany(resources: readonly NewResource[]): Promise<number>;
  /** @throws PlateTakenError */
  update(id: string, details: ResourceDetails): Promise<StoredResource | undefined>;
  /** @throws PlateTakenError when restoring a plate another active resource now uses. */
  setArchived(id: string, archived: boolean): Promise<StoredResource | undefined>;
}

export interface DocumentRepository {
  get(id: string): Promise<StoredDocument | undefined>;
  /** @throws DocumentTypeTakenError */
  add(resourceId: string, document: NewDocument): Promise<StoredDocument>;
  /** @throws DocumentTypeTakenError */
  update(id: string, document: NewDocument): Promise<StoredDocument | undefined>;
  remove(id: string): Promise<boolean>;
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

/** The current time; tests fix it. */
export interface Clock {
  now(): Temporal.Instant;
}

export type Ports = {
  readonly resources: ResourceRepository;
  readonly documents: DocumentRepository;
  readonly referenceLists: ReferenceListRepository;
  readonly bookings: BookingRepository;
  readonly clock: Clock;
};
