# Whitelist Shortcuts - Quick Reference

## Problem

Your Electron app needs to:
- ✅ Block keyboard shortcuts (Ctrl+A/C/V/X) from reaching other apps
- ✅ Allow app control shortcuts (Ctrl+H/R/B/Q) to work in `focusable: false` window

## Solution

C++ keyboard hook + Node.js callback system that bypasses Electron's globalShortcut limitations.

## Current Implementation

### Whitelisted Shortcuts
- **Ctrl+H** - Take screenshot
- **Ctrl+R** - Reset queue
- **Ctrl+B** - Toggle visibility
- **Ctrl+Q** - Quit app

### Blocked Shortcuts
All other Ctrl+[key] combinations are blocked from reaching other applications.

## Quick Start

### Development

```bash
# 1. Build native module (first time only)
cd native
npm install
node-gyp rebuild
cd ..

# 2. Build and run
npm run dev
```

### Testing

Open `test-whitelist-shortcuts.html` in a browser, then test:
- Ctrl+A/C/V/X should NOT work in browser ❌
- Ctrl+H/R/B/Q should work in your app ✅

### Production Packaging

```bash
# Verify native module exists
node scripts/verify-native-module.js

# Package for Windows
npm run dist:win

# Output: release/interview-code-v1.0.0-win-x64-portable.exe
```

## How It Works

```
User presses Ctrl+H
    ↓
C++ hook intercepts (low-level, before browser)
    ↓
Check if 'H' is in whitelist
    ↓
Yes → Call Node.js callback → Execute screenshot function ✓
No  → Block the key ❌
```

## Documentation

- **[Complete Setup Guide](docs/WHITELIST_SETUP.md)** - Full implementation details
- **[Packaging Guide](docs/PACKAGING_NATIVE_MODULE.md)** - How native modules are packaged

## Key Files

- `native/keyboard_hook.cc` - C++ hook with whitelist
- `src/services/keyboardProtection.ts` - TypeScript service
- `src/main.ts` - Register shortcut handlers
- `package.json` - Packaging config with asarUnpack

## Adding New Shortcuts

In `src/main.ts`:

```typescript
// 1. Register the handler
keyboardProtection.registerShortcutHandler('N', () => {
  // Your function here
  console.log('Ctrl+N pressed!');
});

// 2. The key is automatically added to whitelist when protection enables
```

## Troubleshooting

**Native module not found?**
```bash
cd native && npm install && node-gyp rebuild && cd ..
```

**Packaged exe doesn't work?**
- Check DevTools console for "Native module loaded successfully"
- Verify `app.asar.unpacked/native/build/Release/keyboard_hook.node` exists

**Shortcuts not working in dev?**
- Ensure keyboard protection is enabled
- Check console for "Keyboard protection enabled"

## Requirements

- **Windows**: Visual Studio Build Tools
- **Node.js**: v16+ with node-gyp
- **Electron**: v27+

## Status

✅ Windows implementation complete
✅ Packaging configured
✅ Testing tools provided
⏳ macOS support pending
