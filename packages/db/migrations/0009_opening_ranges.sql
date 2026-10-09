CREATE TABLE "site_opening" (
	"site_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	CONSTRAINT "site_opening_site_id_weekday_start_minute_pk" PRIMARY KEY("site_id","weekday","start_minute"),
	CONSTRAINT "site_opening_weekday" CHECK ("site_opening"."weekday" between 1 and 7),
	CONSTRAINT "site_opening_range" CHECK ("site_opening"."start_minute" >= 0 and "site_opening"."end_minute" <= 1440 and "site_opening"."end_minute" > "site_opening"."start_minute")
);
--> statement-breakpoint
ALTER TABLE "site_opening" ADD CONSTRAINT "site_opening_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Written by hand: within one day, the opening ranges of a site do not overlap (rule 4).
-- Ranges that touch, 06:00-12:00 then 12:00-14:00, are allowed: int4range is half-open.
ALTER TABLE "site_opening" ADD CONSTRAINT "site_opening_no_overlap"
  EXCLUDE USING gist ("site_id" WITH =, "weekday" WITH =, int4range("start_minute", "end_minute") WITH &&);
