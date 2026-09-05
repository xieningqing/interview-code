const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const source = path.join(projectRoot, '.env.example');
const releaseDir = path.join(projectRoot, 'release');
const destination = path.join(releaseDir, '.env.example');

if (!fs.existsSync(source)) {
  throw new Error(`Missing environment template: ${source}`);
}

fs.mkdirSync(releaseDir, { recursive: true });

const releaseEntries = fs.readdirSync(releaseDir, { withFileTypes: true });
const portableExecutables = releaseEntries
  .filter((entry) => entry.isFile() && /-portable\.exe$/i.test(entry.name))
  .map((entry) => entry.name);

if (portableExecutables.length !== 1) {
  throw new Error(
    `Expected exactly one portable executable in ${path.dirname(destination)}, found ${portableExecutables.length}`
  );
}

for (const entry of releaseEntries) {
  if (entry.name !== portableExecutables[0] && entry.name !== '.env.example') {
    fs.rmSync(path.join(releaseDir, entry.name), { recursive: true, force: true });
  }
}

fs.copyFileSync(source, destination);
console.log(`Copied .env.example to ${destination}`);
