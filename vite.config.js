import fs from 'fs';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const rootScripts = [
  'sleep-utils.js',
  'nightly.js',
  'quick-actions.js',
  'dashboard.js',
  'quality.js',
  'log.js',
  'entry-modal.js',
  'charts.js',
  'stats.js',
  'stats-aggregates.js',
  'settings.js',
  'about.js',
  'local-supabase-presets.js',
  'routes-data.mjs',
  'dashboard-boot.js',
  'log-boot.js',
  'quality-boot.js',
  'nightly-boot.js',
  'charts-boot.js',
  'stats-boot.js',
  'settings-boot.js',
  'about-boot.js',
  'math-tests.js'
].filter((f) => fs.existsSync(f));

const mpaShells = [
  'dashboard.html',
  'log.html',
  'quality.html',
  'nightly.html',
  'charts.html',
  'stats.html',
  'settings.html',
  'about.html'
].filter((f) => fs.existsSync(f));

const staticCopyTargets = [
  { src: 'assets', dest: 'assets' },
  { src: 'data', dest: 'data' },
  { src: 'theme-toggle.css', dest: '.' },
  { src: 'styles.css', dest: '.' },
  ...rootScripts.map((f) => ({ src: f, dest: '.' })),
  /* MPA shells under /mpa/ only — root *.html redirects (vercel.json) must not break SPA fragment fetch */
  ...mpaShells.map((f) => ({ src: f, dest: 'mpa' }))
];
if (fs.existsSync('dev-git-branch.js')) {
  staticCopyTargets.push({ src: 'dev-git-branch.js', dest: '.' });
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
