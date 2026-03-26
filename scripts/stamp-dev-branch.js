/**
 * Writes dev-git-branch.js from the current git branch (repo root).
 * Run: node scripts/stamp-dev-branch.js
 *
 * Optional hooks: git config core.hooksPath hooks
 * (hooks/post-checkout and hooks/post-merge call this script.)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const outPath = path.join(root, 'dev-git-branch.js');

let branch = '';
try {
  branch = execSync('git rev-parse --abbrev-ref HEAD', {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
} catch (_) {
  /* not a git repo or git unavailable */
}

const contents = `window.__DEV_GIT_BRANCH__ = ${JSON.stringify(branch)};\n`;
fs.writeFileSync(outPath, contents, 'utf8');
console.log('dev-git-branch.js ->', JSON.stringify(branch));
