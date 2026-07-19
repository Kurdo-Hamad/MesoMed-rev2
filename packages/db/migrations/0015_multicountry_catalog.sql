-- Multi-country catalog expansion (ADR-0055). Three additive changes,
-- shipped as a NEW migration file (F-21 rule — shipped migrations are
-- never edited):
--   * search_documents.country_iso — ISO2 country copied from the
--     directory event payload by the indexing subscribers. Nullable:
--     documents indexed before the field existed carry null until a seed
--     re-run re-emits their events.
--   * provider_profiles.country_code — ISO2 country the provider operates
--     in; NOT NULL DEFAULT 'IQ' keeps the addition additive (every
--     existing provider is Iraqi by construction).
--   * providers_type_check — the directory provider-type vocabulary gains
--     the three new facility-backed categories (hair_transplant,
--     weight_management, physiotherapy). Directory-side only: identity's
--     PROVIDER_PROFILE_TYPES five-value vocabulary is unchanged.
ALTER TABLE "search_documents" ADD COLUMN "country_iso" text;--> statement-breakpoint
ALTER TABLE "provider_profiles" ADD COLUMN "country_code" text DEFAULT 'IQ' NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" DROP CONSTRAINT "providers_type_check";--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_type_check" CHECK ("providers"."provider_type" in ('doctor', 'hospital', 'laboratory', 'pharmacy', 'home_nursing', 'dental_clinic', 'beauty_center', 'hair_transplant', 'weight_management', 'physiotherapy'));
