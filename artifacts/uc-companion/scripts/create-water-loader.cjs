// Preserve the earlier generator entry point without restoring obsolete artwork.
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
execFileSync(process.execPath, [join(__dirname, 'generate-filter-loader.mjs')], { stdio: 'inherit' });