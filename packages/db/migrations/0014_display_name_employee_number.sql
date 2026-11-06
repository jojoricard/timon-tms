ALTER TABLE "resource" DROP CONSTRAINT "resource_driver_fields";--> statement-breakpoint
CREATE UNIQUE INDEX "resource_driver_employee_number" ON "resource" USING btree (lower("employee_number")) WHERE "resource"."kind" = 'driver';--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_driver_fields" CHECK ("resource"."kind" <> 'driver' or ("resource"."last_name" is not null and "resource"."first_name" is not null and "resource"."plate" is null and "resource"."vehicle_kind" is null));--> statement-breakpoint
-- Written by hand. SPEC-001 rule 8: a display name is stored only when typed, and built from
-- the names when read. This function builds it as the domain's defaultDisplayName does: the
-- first character of the first name in capitals, a dot, a space, the last name. The collation
-- pg_unicode_fast applies Unicode's full case mapping whatever the database's locale, as
-- toLocaleUpperCase does. A test compares the two on the seed drivers and composed names.
CREATE FUNCTION "driver_display_name"("first_name" text, "last_name" text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN CASE
    WHEN btrim("first_name") = '' THEN btrim("last_name")
    ELSE upper(left(btrim("first_name"), 1) COLLATE "pg_unicode_fast") || '. ' || btrim("last_name")
  END;
--> statement-breakpoint
-- A display name equal to the one built from the names was filled in, not typed: it is emptied,
-- so that it follows the names from now on.
UPDATE "resource" SET "display_name" = NULL
  WHERE "kind" = 'driver' AND "display_name" = "driver_display_name"("first_name", "last_name");
