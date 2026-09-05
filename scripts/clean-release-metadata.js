const fs = require('fs');
const path = require('path');

const releaseDir = path.resolve(__dirname, '..', 'release');

if (!fs.existsSync(releaseDir)) {
  process.exit(0);
}

for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
  if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
    fs.unlinkSync(path.join(releaseDir, entry.name));
  }
}
