CREATE TABLE "resource_protective_equipment" (
	"resource_id" uuid NOT NULL,
	"protective_equipment_id" uuid NOT NULL,
	CONSTRAINT "resource_protective_equipment_resource_id_protective_equipment_id_pk" PRIMARY KEY("resource_id","protective_equipment_id")
);
--> statement-breakpoint
ALTER TABLE "resource_protective_equipment" ADD CONSTRAINT "resource_protective_equipment_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_protective_equipment" ADD CONSTRAINT "resource_protective_equipment_protective_equipment_id_protective_equipment_id_fk" FOREIGN KEY ("protective_equipment_id") REFERENCES "public"."protective_equipment"("id") ON DELETE no action ON UPDATE no action;