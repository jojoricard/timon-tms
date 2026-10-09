import type { z } from '@hono/zod-openapi';
import type * as customerSchemas from './customer-schemas.ts';
import type * as schemas from './schemas.ts';

// The shapes the API answers with, for its clients. Type-only: no code crosses over.
export type ResourceJson = z.infer<typeof schemas.Resource>;
export type DocumentJson = z.infer<typeof schemas.Document>;
export type ResourceListJson = z.infer<typeof schemas.ResourceList>;
export type ResourceSummaryJson = z.infer<typeof schemas.ResourceSummary>;
export type ResourceInputJson = z.infer<typeof schemas.ResourceInput>;
export type DocumentInputJson = z.infer<typeof schemas.DocumentInput>;
export type ReferenceListsJson = z.infer<typeof schemas.ReferenceLists>;
export type DocumentTypeJson = z.infer<typeof schemas.DocumentType>;
export type ListItemJson = z.infer<typeof schemas.ListItem>;
export type ExpiryListJson = z.infer<typeof schemas.ExpiryList>;
export type ExpiryJson = z.infer<typeof schemas.Expiry>;
export type ImportCheckJson = z.infer<typeof schemas.ImportCheck>;
export type IssueJson = z.infer<typeof schemas.Issue>;
export type PlateOwnerJson = z.infer<typeof schemas.PlateOwner>;
export type CustomerJson = z.infer<typeof customerSchemas.Customer>;
export type CustomerWithSitesJson = z.infer<typeof customerSchemas.CustomerWithSites>;
export type CustomerListJson = z.infer<typeof customerSchemas.CustomerList>;
export type CustomerInputJson = z.infer<typeof customerSchemas.CustomerInput>;
export type CustomerOwnerJson = z.infer<typeof customerSchemas.CustomerOwner>;
export type ContactJson = z.infer<typeof customerSchemas.Contact>;
export type SiteJson = z.infer<typeof customerSchemas.Site>;
export type SiteListJson = z.infer<typeof customerSchemas.SiteList>;
export type SiteInputJson = z.infer<typeof customerSchemas.SiteInput>;
export type NearbySiteJson = z.infer<typeof customerSchemas.NearbySite>;
export type OpeningJson = z.infer<typeof customerSchemas.Opening>;
export type AddressCandidateJson = z.infer<
  typeof customerSchemas.AddressSuggestions
>['candidates'][number];
export type CustomerImportCheckJson = z.infer<typeof customerSchemas.CustomerImportCheck>;
export type SiteImportCheckJson = z.infer<typeof customerSchemas.SiteImportCheck>;
