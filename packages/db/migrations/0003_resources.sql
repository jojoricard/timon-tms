CREATE TABLE "body_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text,
	"name" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "body_type_company_code" UNIQUE("company_id","code"),
	CONSTRAINT "body_type_code_or_name" CHECK (code is not null or name is not null)
);
--> statement-breakpoint
CREATE TABLE "capability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text,
	"name" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "capability_company_code" UNIQUE("company_id","code"),
	CONSTRAINT "capability_code_or_name" CHECK (code is not null or name is not null)
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"time_zone" text DEFAULT 'Europe/Paris' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"document_type_id" uuid NOT NULL,
	"reference" text,
	"issued_on" date,
	"expires_on" date NOT NULL,
	CONSTRAINT "document_resource_type" UNIQUE("resource_id","document_type_id"),
	CONSTRAINT "document_issued_before_expiry" CHECK ("document"."issued_on" is null or "document"."issued_on" <= "document"."expires_on")
);
--> statement-breakpoint
CREATE TABLE "document_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text,
	"name" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"applies_to" text[] NOT NULL,
	"blocking" boolean NOT NULL,
	"warn_days" integer DEFAULT 30 NOT NULL,
	CONSTRAINT "document_type_company_code" UNIQUE("company_id","code"),
	CONSTRAINT "document_type_code_or_name" CHECK (code is not null or name is not null),
	CONSTRAINT "document_type_warn_days" CHECK ("document_type"."warn_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "resource_capability" (
	"resource_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	CONSTRAINT "resource_capability_resource_id_capability_id_pk" PRIMARY KEY("resource_id","capability_id")
);
--> statement-breakpoint
CREATE TABLE "subsidiary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_label" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text,
	"name" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "trade_label_company_code" UNIQUE("company_id","code"),
	CONSTRAINT "trade_label_code_or_name" CHECK (code is not null or name is not null)
);
--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "subsidiary_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "employee_number" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "plate" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "plate_key" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "vehicle_kind" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "gvw_kg" integer;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "gcw_kg" integer;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "make_model" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "body_type_id" uuid;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "trade_label_id" uuid;--> statement-breakpoint
ALTER TABLE "body_type" ADD CONSTRAINT "body_type_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability" ADD CONSTRAINT "capability_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_document_type_id_document_type_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_type" ADD CONSTRAINT "document_type_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_capability" ADD CONSTRAINT "resource_capability_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_capability" ADD CONSTRAINT "resource_capability_capability_id_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capability"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subsidiary" ADD CONSTRAINT "subsidiary_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_label" ADD CONSTRAINT "trade_label_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_subsidiary_id_subsidiary_id_fk" FOREIGN KEY ("subsidiary_id") REFERENCES "public"."subsidiary"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_body_type_id_body_type_id_fk" FOREIGN KEY ("body_type_id") REFERENCES "public"."body_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_trade_label_id_trade_label_id_fk" FOREIGN KEY ("trade_label_id") REFERENCES "public"."trade_label"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_active_plate" ON "resource" USING btree ("plate_key") WHERE "resource"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_driver_fields" CHECK ("resource"."kind" <> 'driver' or ("resource"."last_name" is not null and "resource"."first_name" is not null and "resource"."display_name" is not null and "resource"."plate" is null and "resource"."vehicle_kind" is null));--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_vehicle_fields" CHECK ("resource"."kind" = 'driver' or ("resource"."plate" is not null and "resource"."plate_key" is not null and "resource"."vehicle_kind" is not null and "resource"."category" is not null and "resource"."gvw_kg" is not null and "resource"."last_name" is null));--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_kind_category" CHECK ("resource"."vehicle_kind" is null or ("resource"."kind" = 'power-unit' and (
        ("resource"."vehicle_kind" = 'light-van' and "resource"."category" = 'N1') or
        ("resource"."vehicle_kind" in ('rigid-truck', 'tractor') and "resource"."category" in ('N2', 'N3'))
      )) or ("resource"."kind" = 'trailer' and (
        ("resource"."vehicle_kind" = 'semi-trailer' and "resource"."category" in ('O3', 'O4')) or
        ("resource"."vehicle_kind" = 'drawbar-trailer' and "resource"."category" in ('O1', 'O2', 'O3', 'O4'))
      )));--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_weights" CHECK (("resource"."gvw_kg" is null or "resource"."gvw_kg" > 0) and ("resource"."gcw_kg" is null or ("resource"."kind" = 'power-unit' and "resource"."gcw_kg" > "resource"."gvw_kg")));--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_tractor_body_type" CHECK ("resource"."vehicle_kind" is distinct from 'tractor' or "resource"."body_type_id" is null);--> statement-breakpoint
ALTER TABLE "resource" DROP COLUMN "name";
