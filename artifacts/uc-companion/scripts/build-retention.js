const fs = require('node:fs');
const path = require('node:path');

// Older releases kept manifests only at the root. Preserve their pairing
// before the root files are replaced, so native rollback stays possible.
function preserveLegacyManifests(staticBuild) {
  for (const platform of ['ios', 'android']) {
    const legacyPath = path.join(staticBuild, platform, 'manifest.json');
    if (!fs.existsSync(legacyPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    const previousId = manifest.launchAsset?.url?.match(/\/(\d+-\d+)\/_expo\//)?.[1];
    if (previousId && fs.existsSync(path.join(staticBuild, previousId))) {
      const previousDirectory = path.join(staticBuild, previousId, platform);
      fs.mkdirSync(previousDirectory, { recursive: true });
      const previousManifest = path.join(previousDirectory, 'manifest.json');
      if (!fs.existsSync(previousManifest)) fs.copyFileSync(legacyPath, previousManifest);
    }
  }
}

module.exports = { preserveLegacyManifests };