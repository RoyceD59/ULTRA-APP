const fs = require('node:fs');
const path = require('node:path');

function publishWebIcon(projectRoot) {
  const source = path.join(projectRoot, 'assets/images/icon.png');
  const bytes = fs.readFileSync(source);
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('Companion browser icon must be a valid PNG');
  }
  const destination = path.join(projectRoot, 'static-build/favicon.png');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return destination;
}

module.exports = { publishWebIcon };