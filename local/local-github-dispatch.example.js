/**
 * Local GitHub token for the dev-banner 📥 button (copy prod into dev Supabase).
 *
 * Copy this file to local/local-github-dispatch.js (gitignored) and paste a token.
 * Restart `npm run dev` after creating it (vite.config.js only picks it up at startup).
 * If the file is missing, the 📥 button stays disabled.
 *
 * Token: GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token
 *   - Repository access: Only select repositories → rsairu/sleep
 *   - Repository permissions: Actions → Read and write (Metadata: read is added automatically)
 *   - Pick an expiry; nothing else is needed.
 *
 * The token is served to the browser by the local dev server, so keep it scoped to this one
 * repo and Actions only, and don't run the dev server with --host on a shared network.
 */
window.__RESTORE_GITHUB_DISPATCH__ = {
  token: '',
  // Branch the workflow runs from (must contain the workflow file). Defaults to master.
  ref: 'master'
};
