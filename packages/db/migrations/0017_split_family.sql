-- SPEC-004, Splitting an order: the order a family was split from, the same for every order
-- split from it, however many times. Its orders share the customer's reference without a
-- warning. Empty for an order never split.
ALTER TABLE "transport_order" ADD COLUMN "split_root_id" uuid;--> statement-breakpoint
ALTER TABLE "transport_order" ADD CONSTRAINT "transport_order_split_root_id_transport_order_id_fk" FOREIGN KEY ("split_root_id") REFERENCES "public"."transport_order"("id") ON DELETE no action ON UPDATE no action;