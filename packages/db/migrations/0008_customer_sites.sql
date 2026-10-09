CREATE TABLE "customer_site" (
	"customer_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	CONSTRAINT "customer_site_customer_id_site_id_pk" PRIMARY KEY("customer_id","site_id")
);
--> statement-breakpoint
ALTER TABLE "customer_site" ADD CONSTRAINT "customer_site_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_site" ADD CONSTRAINT "customer_site_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_site_site_idx" ON "customer_site" USING btree ("site_id");