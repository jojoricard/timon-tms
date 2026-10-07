import type { z } from '@hono/zod-openapi';
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
