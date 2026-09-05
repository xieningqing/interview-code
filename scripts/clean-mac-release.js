const fs = require('fs');
const path = require('path');

const releaseDir = path.resolve(__dirname, '..', 'release');
const releaseEntries = fs.readdirSync(releaseDir, { withFileTypes: true });
const macArchives = releaseEntries.filter(
  (entry) => entry.isFile() && /-mac-x64\.zip$/i.test(entry.name)
);

if (macArchives.length !== 1) {
  throw new Error(
    `Expected exactly one macOS zip in ${releaseDir}, found ${macArchives.length}`
  );
}

for (const entry of releaseEntries) {
  if (entry.name !== macArchives[0].name) {
    fs.rmSync(path.join(releaseDir, entry.name), { recursive: true, force: true });
  }
}

console.log(`macOS release contains only ${macArchives[0].name}`);
