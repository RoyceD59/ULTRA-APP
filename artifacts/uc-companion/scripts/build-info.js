const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { COMPANION_TABS } = require('../lib/companionLayout.ts');

function writeBuildInfo(projectRoot, buildId, env = process.env) {
  for (const tab of COMPANION_TABS) {
    if (!fs.existsSync(path.join(projectRoot, 'app', '(tabs)', `${tab.name}.tsx`))) {
      throw new Error(`Release is missing the ${tab.name} tab`);
    }
  }
  let revision = env.GITHUB_SHA || env.SOURCE_REVISION || null;
  if (!revision) {
    try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { /* Source archives have no Git metadata; explicitly report unknown. */ }
  }
  const info = { buildId, revision, builtAt: new Date().toISOString(), tabs: COMPANION_TABS.map(tab => tab.name) };
  fs.writeFileSync(path.join(projectRoot, 'static-build', buildId, 'build-info.json'), JSON.stringify(info, null, 2));
  return info;
}
module.exports = { writeBuildInfo };
