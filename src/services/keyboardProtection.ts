import { ipcMain } from 'electron';
import path from 'path';

interface KeyboardHookNative {
  enableHook(): boolean;
  disableHook(): boolean;
  isHookActive(): boolean;
  configureKeys(config: {
    blockLeftCtrl?: boolean;      // NEW: Completely block left Ctrl key
    blockLeftCmd?: boolean;        // NEW: Completely block left Cmd/Win key
    blockCtrlCombos?: boolean;     // Legacy: Block any Ctrl combos
    blockCmdCombos?: boolean;      // Legacy: Block any Cmd combos
    keys?: string[];
    whitelistKeys?: string[];      // NEW: Keys that should always work with Ctrl (e.g., H, R, B, Q)
  }): boolean;
  setShortcutCallback(callback: (key: string) => void): boolean;  // NEW: Callback for whitelist shortcuts
}

interface ShortcutConfig {
  key: string;
  label: string;
  enabled: boolean;
}

let keyboardHook: KeyboardHookNative | null = null;
let isEnabled = false;
let shortcuts: ShortcutConfig[] = [];
let shortcutHandlers: Map<string, () => void> = new Map();  // NEW: Handlers for whitelist shortcuts
let currentConfig: {
  blockLeftCtrl: boolean;
  blockLeftCmd: boolean;
  blockCtrlCombos: boolean;
  blockCmdCombos: boolean;
  keys: string[];
  whitelistKeys: string[];  // NEW: App shortcuts that should always work
} = {
  blockLeftCtrl: false,
  blockLeftCmd: false,
  blockCtrlCombos: false,
  blockCmdCombos: false,
  keys: [],
  whitelistKeys: []  // Default: H, R, B, Q for app control
};

// Load native module
function loadNativeModule(): KeyboardHookNative | null {
  try {
    if (process.platform === 'win32') {
      const nativePath = path.join(__dirname, '../../native/build/Release/keyboard_hook.node');
      keyboardHook = require(nativePath);
      console.log('[KeyboardProtection] Native module loaded successfully');
      return keyboardHook;
    } else {
      console.warn('[KeyboardProtection] Only Windows is supported currently');
      return null;
    }
  } catch (error) {
    console.error('[KeyboardProtection] Failed to load native module:', error);
    return null;
  }
}

// Parse accelerator string to get modifier and key
function parseAccelerator(accelerator: string): { isCtrl: boolean; isCmd: boolean; key: string | null } {
  const parts = accelerator.split('+');
  let isCtrl = false;
  let isCmd = false;
  let key: string | null = null;

  for (const part of parts) {
    const normalized = part.trim();
    if (normalized === 'Control' || normalized === 'Ctrl' || normalized === 'CommandOrControl') {
      if (process.platform === 'darwin') {
        isCmd = true;
      } else {
        isCtrl = true;
      }
    } else if (normalized === 'Command' || normalized === 'Cmd') {
      isCmd = true;
    } else {
      key = normalized;
    }
  }

  return { isCtrl, isCmd, key };
}

// Update configuration from shortcuts
function updateConfigFromShortcuts(): void {
  currentConfig = {
    blockLeftCtrl: false,
    blockLeftCmd: false,
    blockCtrlCombos: false,
    blockCmdCombos: false,
    keys: [],
    whitelistKeys: ['H', 'R', 'B', 'Q', 'ENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN']  // App control shortcuts
  };

  const enabledShortcuts = shortcuts.filter(s => s.enabled);
  const keys = new Set<string>();

  // Check if we have any shortcuts that need left-side blocking
  let hasLeftCtrlShortcuts = false;
  let hasLeftCmdShortcuts = false;

  for (const shortcut of enabledShortcuts) {
    const parsed = parseAccelerator(shortcut.key);

    if (parsed.isCtrl) {
      hasLeftCtrlShortcuts = true;
    }
    if (parsed.isCmd) {
      hasLeftCmdShortcuts = true;
    }
    if (parsed.key) {
      keys.add(parsed.key);
    }
  }

  // Use the THOROUGH blocking strategy: block the left modifier key completely
  // This prevents ALL events (keydown, keyup, keypress) from reaching the browser
  if (hasLeftCtrlShortcuts) {
    currentConfig.blockLeftCtrl = true;  // Block left Ctrl entirely
  }
  if (hasLeftCmdShortcuts) {
    currentConfig.blockLeftCmd = true;   // Block left Cmd/Win entirely
  }

  currentConfig.keys = Array.from(keys);
}

// Enable keyboard protection
function enable(): boolean {
  if (!keyboardHook) {
    keyboardHook = loadNativeModule();
    if (!keyboardHook) {
      return false;
    }
  }

  try {
    // Update config from shortcuts
    updateConfigFromShortcuts();

    // If no shortcuts enabled, just return success
    if (!currentConfig.blockLeftCtrl && !currentConfig.blockLeftCmd &&
        !currentConfig.blockCtrlCombos && !currentConfig.blockCmdCombos) {
      console.log('[KeyboardProtection] No shortcuts enabled');
      isEnabled = false;
      return true;
    }

    // Set up callback for whitelist shortcuts
    // Note: Don't capture shortcutHandlers in closure - always reference current Map
    keyboardHook.setShortcutCallback((key: string) => {
      console.log('[KeyboardProtection] Whitelist shortcut triggered:', key);
      console.log('[KeyboardProtection] Current handlers:', Array.from(shortcutHandlers.keys()));
      const handler = shortcutHandlers.get(key);
      if (handler) {
        console.log('[KeyboardProtection] Executing handler for:', key);
        handler();
      } else {
        console.warn('[KeyboardProtection] No handler registered for:', key);
      }
    });

    // Configure keys to block
    keyboardHook.configureKeys(currentConfig);

    // Enable hook
    const result = keyboardHook.enableHook();
    if (result) {
      isEnabled = true;
      console.log('[KeyboardProtection] Enabled with config:', currentConfig);
    }
    return result;
  } catch (error) {
    console.error('[KeyboardProtection] Failed to enable:', error);
    return false;
  }
}

// Disable keyboard protection
function disable(): boolean {
  if (!keyboardHook || !isEnabled) {
    return true;
  }

  try {
    const result = keyboardHook.disableHook();
    if (result) {
      isEnabled = false;
      console.log('[KeyboardProtection] Disabled');
    }
    return result;
  } catch (error) {
    console.error('[KeyboardProtection] Failed to disable:', error);
    return false;
  }
}

// Check if protection is active
function isActive(): boolean {
  if (!keyboardHook) {
    return false;
  }
  try {
    return keyboardHook.isHookActive();
  } catch (error) {
    return false;
  }
}

// Get enabled shortcuts count
function getEnabledCount(): number {
  return shortcuts.filter(s => s.enabled).length;
}

// Get shortcuts
function getShortcuts(): ShortcutConfig[] {
  return shortcuts;
}

// Update shortcuts
function updateShortcuts(newShortcuts: ShortcutConfig[]): boolean {
  shortcuts = newShortcuts;

  // If currently enabled, reapply the configuration
  if (isEnabled) {
    disable();
    return enable();
  }

  return true;
}

// Initialize with default shortcuts
function initialize(): void {
  shortcuts = [
    { key: 'Control+C', label: 'Copy (Ctrl+C)', enabled: false },
    { key: 'Control+V', label: 'Paste (Ctrl+V)', enabled: false },
    { key: 'Control+X', label: 'Cut (Ctrl+X)', enabled: false },
    { key: 'Control+A', label: 'Select All (Ctrl+A)', enabled: false },
    { key: 'Control+Z', label: 'Undo (Ctrl+Z)', enabled: false },
    { key: 'Control+Y', label: 'Redo (Ctrl+Y)', enabled: false },
    { key: 'Control+F', label: 'Find (Ctrl+F)', enabled: false },
    { key: 'Control+S', label: 'Save (Ctrl+S)', enabled: false },
  ];
}

// Cleanup on app exit
function cleanup(): void {
  if (isEnabled) {
    disable();
  }
}

// Initialize on module load
initialize();

// Register a handler for a whitelist shortcut
function registerShortcutHandler(key: string, handler: () => void): void {
  shortcutHandlers.set(key, handler);
}

// Unregister a handler
function unregisterShortcutHandler(key: string): void {
  shortcutHandlers.delete(key);
}

export default {
  enable,
  disable,
  isActive,
  getEnabledCount,
  getShortcuts,
  updateShortcuts,
  cleanup,
  registerShortcutHandler,
  unregisterShortcutHandler
};