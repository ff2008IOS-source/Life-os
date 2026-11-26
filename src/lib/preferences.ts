/** Display preferences that follow the owner's account across devices. */
export const PREFERENCE_KEYS = [
  "calendar_view",
  "calendar_hidden",
  "calendar_kind",
  "calendar_group",
  "technical_details",
  "sidebar_collapsed",
  "today_skips",
] as const;
export type PreferenceKey = (typeof PREFERENCE_KEYS)[number];
