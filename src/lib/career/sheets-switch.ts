/**
 * Turns off only the Google Sheets integration (import, mirror and its
 * background checks) without touching the shared Google connection that
 * Calendar uses. Used to prove Life OS works with Sheets unavailable.
 */
export const sheetsDisabled = () => process.env.LIFE_OS_SHEETS_DISABLED === "1";
