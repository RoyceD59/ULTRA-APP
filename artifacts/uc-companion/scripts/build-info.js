const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { COMPANION_TABS } = require('../lib/companionLayout.ts');

function writeBuildInfo(projectRoot, buildId, env = process.env, outputRoot = projectRoot) {
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
  const apiDomain = env.EXPO_PUBLIC_API_DOMAIN;
  if (env.NODE_ENV === 'production' && !apiDomain) throw new Error('Missing production API origin');
  const apiOrigin = apiDomain ? (/^https?:\/\//.test(apiDomain) ? apiDomain : `https://${apiDomain}`).replace(/\/$/, '') : null;
  if (env.NODE_ENV === 'production' && apiOrigin !== 'https://api.ucfilters.com') {
    throw new Error('Invalid production API origin');
  }
  const nativePolicyPath = path.join(projectRoot, 'data/supported-native-releases.json');
  const native = fs.existsSync(nativePolicyPath) ? JSON.parse(fs.readFileSync(nativePolicyPath, 'utf8')).native : [];
  const domain = env.EXPO_PUBLIC_DOMAIN;
  const expoGoLaunchUrl = domain ? `exps://${domain.replace(/^https:\/\//, '').replace(/\/$/, '')}${env.EXPO_PUBLIC_BASE_PATH || ''}` : null;
  const info = { buildId, revision, apiOrigin, production: env.NODE_ENV === 'production', expoGoLaunchUrl, supported: { web: buildId, expoGo: buildId, native },
    builtAt: new Date().toISOString(), tabs: COMPANION_TABS.map(tab => tab.name) };
  const structurePath = path.join(projectRoot, 'data/product-page-structure.json');
  if (fs.existsSync(structurePath)) {
    info.productPageStructure = JSON.parse(fs.readFileSync(structurePath, 'utf8'));
  }
  fs.writeFileSync(path.join(outputRoot, 'static-build', buildId, 'build-info.json'), JSON.stringify(info, null, 2));
  return info;
}
module.exports = { writeBuildInfo };
