const fs = require('node:fs');
const path = require('node:path');

/** Keep versioned assets and manifests until an owner retires a rollback build. */
function prepareStaticBuild(projectRoot, timestamp) {
  const root = path.join(projectRoot, 'static-build');
  for (const platform of ['ios', 'android']) {
    const current = path.join(root, platform, 'manifest.json');
    if (fs.existsSync(current)) {
      const manifest = JSON.parse(fs.readFileSync(current, 'utf8'));
      const id = String(manifest.launchAsset?.key || '').replace(/^bundle-/, '');
      if (/^\d+-\d+$/.test(id)) {
        const archive = path.join(root, id, platform);
        fs.mkdirSync(archive, { recursive: true });
        fs.copyFileSync(current, path.join(archive, 'manifest.json'));
      }
    }
  }
  for (const platform of ['ios', 'android', 'web']) {
    fs.mkdirSync(path.join(root, timestamp, '_expo/static/js', platform), { recursive: true });
  }
  for (const platform of ['ios', 'android']) {
    fs.mkdirSync(path.join(root, platform), { recursive: true });
  }
}
module.exports = { prepareStaticBuild };