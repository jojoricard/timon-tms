CREATE TABLE "site_protective_equipment" (
	"site_id" uuid NOT NULL,
	"protective_equipment_id" uuid NOT NULL,
	CONSTRAINT "site_protective_equipment_site_id_protective_equipment_id_pk" PRIMARY KEY("site_id","protective_equipment_id")
);
--> statement-breakpoint
ALTER TABLE "site_protective_equipment" ADD CONSTRAINT "site_protective_equipment_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_protective_equipment" ADD CONSTRAINT "site_protective_equipment_protective_equipment_id_protective_equipment_id_fk" FOREIGN KEY ("protective_equipment_id") REFERENCES "public"."protective_equipment"("id") ON DELETE no action ON UPDATE no action;