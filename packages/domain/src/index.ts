export { findOverlaps, type ResourceBooking } from './booking.ts';
export {
  companyDay,
  companyTimeZone,
  compareSeverity,
  type DocumentState,
  type DocumentStatus,
  daysUntil,
  documentStatus,
  documentStatuses,
  resourceSeverity,
  type Severity,
  severity,
  severityOrder,
} from './document-status.ts';
export { InvalidPeriodError, overlaps, type Period, periodOf } from './period.ts';
export { plateKey } from './plate.ts';
export {
  type Driver,
  defaultDisplayName,
  powerUnitKinds,
  type Resource,
  type ResourceDetails,
  type ResourceKind,
  resourceKinds,
  resourceName,
  trailerKinds,
  type Vehicle,
  type VehicleCategory,
  type VehicleKind,
  vehicleCategories,
  vehicleKinds,
} from './resource.ts';
export { Temporal } from './temporal.ts';
export {
  allowedCategories,
  canHaveBodyType,
  canPull,
  checkDriver,
  checkResource,
  checkVehicle,
  type Issue,
  vehicleKindsOf,
} from './vehicle-rules.ts';
