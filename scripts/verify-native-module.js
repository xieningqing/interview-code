// Verify native module exists before packaging
const fs = require('fs');
const path = require('path');

console.log('=================================');
console.log('  Native Module Verification');
console.log('=================================\n');

const nativeModule = path.join(__dirname, '../native/build/Release/keyboard_hook.node');
const distExists = fs.existsSync(path.join(__dirname, '../dist'));

// Check native module
if (fs.existsSync(nativeModule)) {
  const stats = fs.statSync(nativeModule);
  console.log('✅ Native module found');
  console.log(`   Path: ${nativeModule}`);
  console.log(`   Size: ${(stats.size / 1024).toFixed(2)} KB`);
  console.log(`   Modified: ${stats.mtime.toLocaleString()}`);
} else {
  console.log('❌ Native module NOT found');
  console.log(`   Expected: ${nativeModule}`);
  console.log('\n   Run this command to build:');
  console.log('   cd native && npm install && node-gyp rebuild && cd ..\n');
  process.exit(1);
}

console.log('');

// Check dist folder
if (distExists) {
  console.log('✅ Dist folder exists');
} else {
  console.log('⚠️  Dist folder not found');
  console.log('   Run: npm run build\n');
  process.exit(1);
}

console.log('');
console.log('=================================');
console.log('✅ Ready to package!');
console.log('=================================');
console.log('\nRun one of these commands:');
console.log('  npm run dist:win  (Windows portable exe)');
console.log('  npm run dist:mac  (macOS zip)');
console.log('  npm run dist      (All platforms)');
console.log('');
