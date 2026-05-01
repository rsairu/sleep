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
  'math-tests.js'
].filter((f) => fs.existsSync(f));

const staticCopyTargets = [
  { src: 'data', dest: 'data' },
  { src: 'theme-toggle.css', dest: '.' },
  { src: 'styles.css', dest: '.' },
  ...rootScripts.map((f) => ({ src: f, dest: '.' }))
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
