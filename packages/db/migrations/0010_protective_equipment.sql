CREATE TABLE "protective_equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text,
	"name" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "protective_equipment_company_code" UNIQUE("company_id","code"),
	CONSTRAINT "protective_equipment_code_or_name" CHECK (code is not null or name is not null)
);
--> statement-breakpoint
ALTER TABLE "protective_equipment" ADD CONSTRAINT "protective_equipment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Written by hand: the list SPEC-002 seeds, with fixed ids like migration 0004.
INSERT INTO "protective_equipment" ("id", "company_id", "code", "sort_order") VALUES
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'safety-shoes', 10),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'high-visibility-vest', 20),
  ('60000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'hard-hat', 30),
  ('60000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'safety-glasses', 40),
  ('60000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'gloves', 50);
