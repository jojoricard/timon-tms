CREATE TABLE "unit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text,
	"period" "tstzrange" NOT NULL,
	"previous_unit_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_id_period" UNIQUE("id","period"),
	CONSTRAINT "unit_period_from_start" CHECK (not isempty("unit"."period") and lower_inc("unit"."period") and not upper_inc("unit"."period") and not lower_inf("unit"."period"))
);
--> statement-breakpoint
CREATE TABLE "unit_member" (
	"unit_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"role" text NOT NULL,
	"period" "tstzrange" NOT NULL,
	CONSTRAINT "unit_member_unit_id_role_pk" PRIMARY KEY("unit_id","role")
);
--> statement-breakpoint
-- Moved before the foreign key that references it.
ALTER TABLE "resource" ADD CONSTRAINT "resource_id_kind" UNIQUE("id","kind");--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_previous_unit_id_unit_id_fk" FOREIGN KEY ("previous_unit_id") REFERENCES "public"."unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_member" ADD CONSTRAINT "unit_member_unit_period_fk" FOREIGN KEY ("unit_id","period") REFERENCES "public"."unit"("id","period") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "unit_member" ADD CONSTRAINT "unit_member_resource_role_fk" FOREIGN KEY ("resource_id","role") REFERENCES "public"."resource"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Written by hand: Drizzle has no exclusion constraint. A resource belongs to at most one unit
-- at any moment (SPEC-003 rule 4). Periods are half-open: a unit ending at 20:00 and another
-- starting at 20:00 do not overlap. btree_gist, created in 0001, compares resource_id with =.
ALTER TABLE "unit_member" ADD CONSTRAINT "unit_member_no_overlap"
  EXCLUDE USING gist ("resource_id" WITH =, "period" WITH &&);
