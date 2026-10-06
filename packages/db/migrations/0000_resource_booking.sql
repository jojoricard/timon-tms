CREATE TABLE "resource" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"period" "tstzrange" NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "resource_booking_period_bounded" CHECK (not isempty("resource_booking"."period") and lower_inc("resource_booking"."period") and not upper_inc("resource_booking"."period") and not lower_inf("resource_booking"."period") and not upper_inf("resource_booking"."period"))
);
--> statement-breakpoint
ALTER TABLE "resource_booking" ADD CONSTRAINT "resource_booking_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE no action ON UPDATE no action;