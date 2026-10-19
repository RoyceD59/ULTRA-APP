const fs = require('node:fs');
const path = require('node:path');
const POINTER = 'active-build.json';

function hasWebEntry(buildRoot) {
  return fs.existsSync(path.join(buildRoot, 'web/index.html'))
    || fs.existsSync(path.join(buildRoot, '_expo/static/js/web/bundle.js'));
}

function validateReleaseInfo(info, buildId) {
  if (info.buildId !== buildId) throw new Error('Build metadata does not match release');
  // Legacy metadata predates advisory supported-release checks.
  if (info.supported && (info.supported.web !== buildId || info.supported.expoGo !== buildId)) {
    throw new Error('Supported browser and Expo Go releases do not match selected build');
  }
  if (info.production && info.apiOrigin !== 'https://api.ucfilters.com') {
    throw new Error('Selected production build has an unapproved API origin');
  }
}

function stagePlatformManifest(projectRoot, buildId, platform, manifest) {
  if (!/^\d+-\d+$/.test(buildId) || !['ios', 'android'].includes(platform)
      || manifest.launchAsset?.key !== `bundle-${buildId}`) {
    throw new Error('Invalid staged Companion manifest');
  }
  const directory = path.join(projectRoot, 'static-build', buildId, platform);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function readActiveBuild(staticRoot) {
  const pointer = path.join(staticRoot, POINTER);
  if (!fs.existsSync(pointer)) return null; // Older builds predate the pointer.
  const { buildId } = JSON.parse(fs.readFileSync(pointer, 'utf8'));
  if (typeof buildId !== 'string' || !/^\d+-\d+$/.test(buildId)) {
    throw new Error('Invalid active Companion build');
  }
  const root = path.join(staticRoot, buildId);
  const info = JSON.parse(fs.readFileSync(path.join(root, 'build-info.json'), 'utf8'));
  validateReleaseInfo(info, buildId);
  if (info.buildId !== buildId || !hasWebEntry(root)) {
    throw new Error('Active Companion build is incomplete');
  }
  return buildId;
}

/** Publish the completed build last, using an atomic rename. */
function activateStaticBuild(projectRoot, buildId) {
  const staticRoot = path.join(projectRoot, 'static-build');
  if (!/^\d+-\d+$/.test(buildId)) throw new Error('Invalid Companion build ID');
  const buildRoot = path.join(staticRoot, buildId);
  const info = JSON.parse(fs.readFileSync(path.join(buildRoot, 'build-info.json'), 'utf8'));
  validateReleaseInfo(info, buildId);
  if (!hasWebEntry(buildRoot)) throw new Error('Incomplete web build');
  for (const platform of ['ios', 'android']) {
    if (!fs.existsSync(path.join(buildRoot, '_expo/static/js', platform, 'bundle.js'))) {
      throw new Error(`Incomplete ${platform} build`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(buildRoot, platform, 'manifest.json'), 'utf8'));
    if (manifest.launchAsset?.key !== `bundle-${buildId}`) throw new Error(`Mismatched ${platform} manifest`);
  }
  const temporary = path.join(staticRoot, `${POINTER}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify({ buildId }));
  fs.renameSync(temporary, path.join(staticRoot, POINTER));
}
module.exports = { readActiveBuild, activateStaticBuild, stagePlatformManifest };