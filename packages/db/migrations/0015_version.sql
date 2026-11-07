-- ADR-005: every record that can be changed carries a version, 1 at creation and plus one at
-- every write. Existing rows start at 1.
ALTER TABLE "customer" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "unit" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
