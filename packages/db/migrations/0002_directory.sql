CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_ckb" text NOT NULL,
	"icon_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"country_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_ckb" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"iso_code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_ckb" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_ckb" text NOT NULL,
	"bio_en" text,
	"bio_ar" text,
	"bio_ckb" text,
	"specialty_key" text NOT NULL,
	"city_id" uuid,
	"photo_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"publicly_visible" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_ckb" text NOT NULL,
	"city_id" uuid NOT NULL,
	"address_en" text,
	"address_ar" text,
	"address_ckb" text,
	"phone" text,
	"email" text,
	"website_or_social" text,
	"about_en" text,
	"about_ar" text,
	"about_ckb" text,
	"why_choose_us_en" text,
	"why_choose_us_ar" text,
	"why_choose_us_ckb" text,
	"active" boolean DEFAULT true NOT NULL,
	"publicly_visible" boolean DEFAULT false NOT NULL,
	"tier_rank" integer DEFAULT 3 NOT NULL,
	"tier_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facility_category_section_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"section_type_id" uuid NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facility_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"alt_text" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facility_section_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label_en" text NOT NULL,
	"label_ar" text NOT NULL,
	"label_ckb" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facility_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"section_type_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_ckb" text NOT NULL,
	"image_path" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homepage_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"category_slug" text NOT NULL,
	"entity_ref" text NOT NULL,
	"city_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"promoted_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homepage_promotions_entity_type_check" CHECK ("homepage_promotions"."entity_type" in ('facility', 'doctor'))
);
--> statement-breakpoint
CREATE TABLE "procedures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_ckb" text NOT NULL,
	"description_en" text,
	"description_ar" text,
	"description_ckb" text,
	"specialty_key" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_type" text NOT NULL,
	"identity_profile_id" uuid,
	"approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "providers_type_check" CHECK ("providers"."provider_type" in ('doctor', 'hospital', 'laboratory', 'pharmacy', 'home_nursing', 'dental_clinic', 'beauty_center'))
);
--> statement-breakpoint
CREATE TABLE "specialties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_ckb" text NOT NULL,
	"description_en" text,
	"description_ar" text,
	"description_ckb" text,
	"image_url" text,
	"alt_text" jsonb,
	"display_order" integer DEFAULT 0 NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "symptom_specialty_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symptom_id" uuid NOT NULL,
	"specialty_key" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "symptoms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_ckb" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_documents" (
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_ckb" text NOT NULL,
	"category_key" text NOT NULL,
	"city_slug" text,
	"publicly_visible" boolean DEFAULT false NOT NULL,
	"rank" integer DEFAULT 3 NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', "search_documents"."name_en" || ' ' || "search_documents"."name_ar" || ' ' || "search_documents"."name_ckb")) STORED NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_documents_entity_type_entity_id_pk" PRIMARY KEY("entity_type","entity_id"),
	CONSTRAINT "search_documents_entity_type_check" CHECK ("search_documents"."entity_type" in ('facility', 'doctor'))
);
--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_category_section_types" ADD CONSTRAINT "facility_category_section_types_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_category_section_types" ADD CONSTRAINT "facility_category_section_types_section_type_id_facility_section_types_id_fk" FOREIGN KEY ("section_type_id") REFERENCES "public"."facility_section_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_media" ADD CONSTRAINT "facility_media_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_sections" ADD CONSTRAINT "facility_sections_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_sections" ADD CONSTRAINT "facility_sections_section_type_id_facility_section_types_id_fk" FOREIGN KEY ("section_type_id") REFERENCES "public"."facility_section_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homepage_promotions" ADD CONSTRAINT "homepage_promotions_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symptom_specialty_map" ADD CONSTRAINT "symptom_specialty_map_symptom_id_symptoms_id_fk" FOREIGN KEY ("symptom_id") REFERENCES "public"."symptoms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_unique" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "cities_slug_unique" ON "cities" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "cities_country_id_idx" ON "cities" USING btree ("country_id");--> statement-breakpoint
CREATE UNIQUE INDEX "countries_slug_unique" ON "countries" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "countries_iso_code_unique" ON "countries" USING btree ("iso_code");--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_profiles_slug_unique" ON "doctor_profiles" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_profiles_provider_id_unique" ON "doctor_profiles" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "doctor_profiles_specialty_key_idx" ON "doctor_profiles" USING btree ("specialty_key","name_en") WHERE "doctor_profiles"."publicly_visible" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "facilities_slug_unique" ON "facilities" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "facilities_provider_id_idx" ON "facilities" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "facilities_city_id_idx" ON "facilities" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "facilities_landing_en_idx" ON "facilities" USING btree ("category_id","tier_rank","name_en","id") WHERE "facilities"."publicly_visible" = true;--> statement-breakpoint
CREATE INDEX "facilities_landing_ar_idx" ON "facilities" USING btree ("category_id","tier_rank","name_ar","id") WHERE "facilities"."publicly_visible" = true;--> statement-breakpoint
CREATE INDEX "facilities_landing_ckb_idx" ON "facilities" USING btree ("category_id","tier_rank","name_ckb","id") WHERE "facilities"."publicly_visible" = true;--> statement-breakpoint
CREATE INDEX "facilities_landing_city_en_idx" ON "facilities" USING btree ("category_id","city_id","tier_rank","name_en","id") WHERE "facilities"."publicly_visible" = true;--> statement-breakpoint
CREATE INDEX "facilities_landing_city_ar_idx" ON "facilities" USING btree ("category_id","city_id","tier_rank","name_ar","id") WHERE "facilities"."publicly_visible" = true;--> statement-breakpoint
CREATE INDEX "facilities_landing_city_ckb_idx" ON "facilities" USING btree ("category_id","city_id","tier_rank","name_ckb","id") WHERE "facilities"."publicly_visible" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "facility_category_section_types_unique" ON "facility_category_section_types" USING btree ("category_id","section_type_id");--> statement-breakpoint
CREATE INDEX "facility_media_facility_id_idx" ON "facility_media" USING btree ("facility_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "facility_section_types_key_unique" ON "facility_section_types" USING btree ("key");--> statement-breakpoint
CREATE INDEX "facility_sections_facility_id_idx" ON "facility_sections" USING btree ("facility_id","section_type_id","sort_order");--> statement-breakpoint
CREATE INDEX "homepage_promotions_city_id_idx" ON "homepage_promotions" USING btree ("city_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "procedures_slug_unique" ON "procedures" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "providers_identity_profile_id_unique" ON "providers" USING btree ("identity_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "specialties_key_unique" ON "specialties" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "symptom_specialty_map_unique" ON "symptom_specialty_map" USING btree ("symptom_id","specialty_key");--> statement-breakpoint
CREATE UNIQUE INDEX "symptoms_slug_unique" ON "symptoms" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "search_documents_name_en_trgm_idx" ON "search_documents" USING gin ("name_en" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "search_documents_name_ar_trgm_idx" ON "search_documents" USING gin ("name_ar" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "search_documents_name_ckb_trgm_idx" ON "search_documents" USING gin ("name_ckb" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "search_documents_search_vector_idx" ON "search_documents" USING gin ("search_vector");