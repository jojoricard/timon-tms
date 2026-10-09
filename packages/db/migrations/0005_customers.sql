CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"country" text DEFAULT 'FR' NOT NULL,
	"siret" text,
	"vat_number" text,
	"billing_street1" text,
	"billing_street2" text,
	"billing_postcode" text,
	"billing_city" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_company_code" UNIQUE("company_id","code"),
	CONSTRAINT "customer_code_upper" CHECK ("customer"."code" = upper("customer"."code")),
	CONSTRAINT "customer_siret_french" CHECK ("customer"."siret" is null or ("customer"."siret" ~ '^[0-9]{14}$' and "customer"."country" = 'FR'))
);
--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_active_siret" ON "customer" USING btree ("company_id","siret") WHERE "customer"."archived_at" is null;