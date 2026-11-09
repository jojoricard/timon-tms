CREATE TABLE "order_counter" (
	"company_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"last_value" integer NOT NULL,
	CONSTRAINT "order_counter_company_id_year_pk" PRIMARY KEY("company_id","year"),
	CONSTRAINT "order_counter_positive" CHECK ("order_counter"."last_value" > 0)
);
--> statement-breakpoint
CREATE TABLE "order_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "order_event_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"author_id" uuid,
	"details" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_goods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"packaging" text NOT NULL,
	"weight_kg" integer NOT NULL,
	"floor_dm" integer,
	"un_number" text,
	"adr_class" text,
	"temperature_min" smallint,
	"temperature_max" smallint,
	"from_stop_id" uuid NOT NULL,
	"from_kind" text DEFAULT 'pickup' NOT NULL,
	"to_stop_id" uuid NOT NULL,
	"to_kind" text DEFAULT 'delivery' NOT NULL,
	CONSTRAINT "order_goods_from_pickup" CHECK ("order_goods"."from_kind" = 'pickup'),
	CONSTRAINT "order_goods_to_delivery" CHECK ("order_goods"."to_kind" = 'delivery'),
	CONSTRAINT "order_goods_quantities" CHECK ("order_goods"."quantity" > 0 and "order_goods"."weight_kg" > 0 and ("order_goods"."floor_dm" is null or "order_goods"."floor_dm" > 0)),
	CONSTRAINT "order_goods_un_number" CHECK ("order_goods"."un_number" is null or "order_goods"."un_number" ~ '^[0-9]{4}$'),
	CONSTRAINT "order_goods_adr" CHECK (("order_goods"."un_number" is null) = ("order_goods"."adr_class" is null)),
	CONSTRAINT "order_goods_temperature" CHECK (("order_goods"."temperature_min" is null) = ("order_goods"."temperature_max" is null) and ("order_goods"."temperature_min" is null or ("order_goods"."temperature_min" between -30 and 30 and "order_goods"."temperature_max" between -30 and 30 and "order_goods"."temperature_min" <= "order_goods"."temperature_max")))
);
--> statement-breakpoint
CREATE TABLE "order_stop" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"site_id" uuid NOT NULL,
	"slot" "tstzrange" NOT NULL,
	"booking_made" boolean DEFAULT false NOT NULL,
	"booking_reference" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "order_stop_order_id_kind" UNIQUE("order_id","id","kind"),
	CONSTRAINT "order_stop_kind" CHECK ("order_stop"."kind" in ('pickup', 'delivery')),
	CONSTRAINT "order_stop_slot_bounded" CHECK (not isempty("order_stop"."slot") and lower_inc("order_stop"."slot") and not upper_inc("order_stop"."slot") and not lower_inf("order_stop"."slot") and not upper_inf("order_stop"."slot")),
	CONSTRAINT "order_stop_booking" CHECK ("order_stop"."booking_reference" is null or "order_stop"."booking_made")
);
--> statement-breakpoint
CREATE TABLE "transport_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"customer_reference" text,
	"notes" text,
	"body_type_id" uuid,
	"side_loading" boolean DEFAULT false NOT NULL,
	"tail_lift" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_order_company_number" UNIQUE("company_id","number"),
	CONSTRAINT "transport_order_status" CHECK ("transport_order"."status" in ('to-plan', 'to-review', 'cancelled')),
	CONSTRAINT "transport_order_cancel_reason" CHECK (("transport_order"."status" = 'cancelled') = ("transport_order"."cancel_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "order_counter" ADD CONSTRAINT "order_counter_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_order_id_transport_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."transport_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_goods" ADD CONSTRAINT "order_goods_order_id_transport_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."transport_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_goods" ADD CONSTRAINT "order_goods_from_pickup_fk" FOREIGN KEY ("order_id","from_stop_id","from_kind") REFERENCES "public"."order_stop"("order_id","id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_goods" ADD CONSTRAINT "order_goods_to_delivery_fk" FOREIGN KEY ("order_id","to_stop_id","to_kind") REFERENCES "public"."order_stop"("order_id","id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_stop" ADD CONSTRAINT "order_stop_order_id_transport_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."transport_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_stop" ADD CONSTRAINT "order_stop_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_order" ADD CONSTRAINT "transport_order_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_order" ADD CONSTRAINT "transport_order_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_order" ADD CONSTRAINT "transport_order_body_type_id_body_type_id_fk" FOREIGN KEY ("body_type_id") REFERENCES "public"."body_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_event_order_idx" ON "order_event" USING btree ("order_id","sequence");--> statement-breakpoint
CREATE INDEX "order_goods_order_idx" ON "order_goods" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_stop_site_idx" ON "order_stop" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "transport_order_customer_reference_idx" ON "transport_order" USING btree ("customer_id","customer_reference");