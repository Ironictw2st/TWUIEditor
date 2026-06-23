// Single source of truth for DB-record loc-key prefixes. A `ContextTextLabel` bound to a
// record context (CcoEffectBundle, CcoCampaignPooledResource, ...) gets its display text from a
// `text/db/*.loc.tsv` table, keyed by `<prefix><record_key>`. The prefixes are not encoded in
// the XML, so this small registry maps object-type + property -> prefix. Kept import-free so
// both records.ts and cco.ts can consume it without an import cycle.

/** object_id -> (property used in the funcId -> loc key prefix). */
export const RECORD_LOC: Record<string, Record<string, string>> = {
  CcoEffectBundle: {
    Name: "effect_bundles_localised_title_",
    Description: "effect_bundles_localised_description_",
  },
  CcoCampaignPooledResource: {
    Name: "pooled_resources_display_name_",
  },
  CcoEquippedSetCeo: {
    Title: "ceo_equipped_set_bonuses_title_",
    Description: "ceo_equipped_set_bonuses_description_",
  },
  CcoEffect: {
    LocalisedDescriptionWithoutScope: "effects_description_",
    Description: "effects_description_",
  },
};
