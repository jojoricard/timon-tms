-- A resource cannot be booked twice over overlapping periods. Written by hand: Drizzle has no
-- exclusion constraint. btree_gist lets the GiST index compare resource_id with =.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "resource_booking" ADD CONSTRAINT "resource_booking_no_overlap"
  EXCLUDE USING gist ("resource_id" WITH =, "period" WITH &&);
