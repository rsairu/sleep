/**
 * Local dev/prod Supabase credentials for the dev-banner preset toggle.
 *
 * Copy this file to local-supabase-presets.js (gitignored) and fill in URL + anon key
 * for both projects. The app loads local-supabase-presets.js before sleep-utils.js;
 * if the file is missing, the toggle is hidden.
 */
window.__RESTORE_SUPABASE_PRESETS__ = {
  dev: {
    url: 'https://pjpzxkyflmzzbfdkujan.supabase.co',
    anonKey: 'sb_publishable_Z_4BMW_jZc945FWCRDSw8A_iUDMirf8'
  },
  prod: {
    url: 'https://lsaguxfovamihwnicpkk.supabase.co',
    anonKey: 'sb_publishable_44EUcthYp49uwugFINFv8w_SQEbcL4R'
  }
};
