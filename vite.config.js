import fs from 'fs';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const libScripts = ['src/lib/time-utils.js', 'src/lib/sleep-utils.js', 'src/lib/stats-aggregates.js', 'src/lib/nightly.js'];
const routeScripts = [
  'src/routes/dashboard.js',
  'src/routes/log.js',
  'src/routes/quality.js',
  'src/routes/charts.js',
  'src/routes/stats.js',
  'src/routes/settings.js',
  'src/routes/about.js',
  'src/routes/quick-actions.js',
  'src/routes/entry-modal.js'
];

const staticCopyTargets = [
  { src: 'data', dest: 'data' },
  { src: 'src/styles/theme-toggle.css', dest: '.' },
  { src: 'src/styles/styles.css', dest: '.' },
  ...[...libScripts, ...routeScripts]
    .filter((f) => fs.existsSync(f))
    .map((f) => ({ src: f, dest: '.' }))
];
if (fs.existsSync('local/dev-git-branch.js')) {
  staticCopyTargets.push({ src: 'local/dev-git-branch.js', dest: '.' });
}
if (fs.existsSync('local/local-supabase-presets.js')) {
  staticCopyTargets.push({ src: 'local/local-supabase-presets.js', dest: '.' });
}

export default defineConfig({
  appType: 'spa',
  root: '.',
  publicDir: 'public',
  plugins: [
    viteStaticCopy({
      targets: staticCopyTargets
    })
  ]
});
