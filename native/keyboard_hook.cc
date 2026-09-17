#include <napi.h>
#include <windows.h>
#include <thread>
#include <atomic>
#include <set>
#include <mutex>

// Global variables
static HHOOK g_hHook = NULL;
static std::atomic<bool> g_isHookActive(false);
static std::thread g_messageThread;
static std::set<DWORD> g_blockedKeys;
static std::mutex g_keysMutex;
static bool g_blockCtrlCombos = false;
static bool g_blockCmdCombos = false;
static bool g_blockLeftCtrl = false;  // NEW: Block left Ctrl completely
static bool g_blockLeftCmd = false;   // NEW: Block left Cmd/Win completely

// Track modifier key states ourselves
static bool g_leftCtrlDown = false;   // Track left Ctrl specifically
static bool g_rightCtrlDown = false;  // Track right Ctrl specifically
static bool g_leftWinDown = false;    // Track left Win specifically
static bool g_rightWinDown = false;   // Track right Win specifically

// Track keys that were pressed with modifier
static std::set<DWORD> g_keysDownWithModifier;
static std::mutex g_trackingMutex;

// Store our own process ID to allow passthrough
static DWORD g_ownProcessId = 0;

// Whitelist for app-specific shortcuts that should always pass through
static std::set<DWORD> g_whitelistKeys;  // Keys like H, R, B, Q
static std::mutex g_whitelistMutex;

// Callback for whitelist shortcuts
static Napi::ThreadSafeFunction g_shortcutCallback;
static std::mutex g_callbackMutex;

// Helper function: Check if any window in our process is visible or exists
bool IsOwnProcessActive() {
    bool found = false;
    EnumWindows([](HWND hwnd, LPARAM lParam) -> BOOL {
        DWORD processId = 0;
        GetWindowThreadProcessId(hwnd, &processId);
        if (processId == g_ownProcessId) {
            // Found a window belonging to our process
            *reinterpret_cast<bool*>(lParam) = true;
            return FALSE; // Stop enumeration
        }
        return TRUE; // Continue enumeration
    }, reinterpret_cast<LPARAM>(&found));
    return found;
}

// Keyboard hook callback function
LRESULT CALLBACK LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode == HC_ACTION) {
        KBDLLHOOKSTRUCT* pKeyboard = (KBDLLHOOKSTRUCT*)lParam;

        // Check if this is a keyboard event (keydown or keyup)
        if (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN ||
            wParam == WM_KEYUP || wParam == WM_SYSKEYUP) {

            DWORD vkCode = pKeyboard->vkCode;
            bool isKeyDown = (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN);

            // === WINDOW CHECK: Don't block if foreground window is ours ===
            HWND foregroundWindow = GetForegroundWindow();
            DWORD foregroundProcessId = 0;
            if (foregroundWindow) {
                GetWindowThreadProcessId(foregroundWindow, &foregroundProcessId);
            }

            // If the foreground window is our own process, don't block anything
            bool isOwnProcess = (foregroundProcessId == g_ownProcessId);
            if (isOwnProcess) {
                return CallNextHookEx(g_hHook, nCode, wParam, lParam);
            }

            // === STRATEGY 1: Block left Ctrl/Cmd completely (most thorough) ===
            // Only block when NOT in our own process

            // Block left Ctrl key completely - all events
            if (g_blockLeftCtrl && vkCode == VK_LCONTROL) {
                if (isKeyDown) {
                    g_leftCtrlDown = true;
                } else {
                    g_leftCtrlDown = false;
                }
                return 1; // Block ALL left Ctrl events (keydown AND keyup)
            }

            // Block left Win/Cmd key completely - all events
            if (g_blockLeftCmd && vkCode == VK_LWIN) {
                if (isKeyDown) {
                    g_leftWinDown = true;
                } else {
                    g_leftWinDown = false;
                }
                return 1; // Block ALL left Win events (keydown AND keyup)
            }

            // === Check whitelist FIRST before blocking ===
            // If this is a whitelist key with Ctrl down, trigger callback and allow BOTH keydown and keyup
            bool isWhitelisted = false;
            {
                std::lock_guard<std::mutex> lock(g_whitelistMutex);
                isWhitelisted = (g_whitelistKeys.count(vkCode) > 0);
            }

            // Debug: Log whitelist check
            if (isWhitelisted && isKeyDown) {
                OutputDebugStringA(("[KeyboardHook] Whitelist key detected: " + std::to_string(vkCode) +
                                   " LeftCtrl=" + std::to_string(g_leftCtrlDown)).c_str());
            }

            // Track whitelist keys to ensure keyup passes through
            static std::set<DWORD> g_whitelistKeysDown;
            static std::mutex g_whitelistTrackingMutex;

            if (isWhitelisted && g_leftCtrlDown) {
                if (isKeyDown) {
                    // Keydown: trigger callback and track this key
                    OutputDebugStringA("[KeyboardHook] Triggering whitelist callback");

                    {
                        std::lock_guard<std::mutex> lock(g_whitelistTrackingMutex);
                        g_whitelistKeysDown.insert(vkCode);
                    }

                    std::lock_guard<std::mutex> lock(g_callbackMutex);
                    if (g_shortcutCallback) {
                        // Convert VK code to string key name
                        std::string keyStr;
                        if (vkCode >= 'A' && vkCode <= 'Z') {
                            keyStr = std::string(1, static_cast<char>(vkCode));
                        } else if (vkCode >= '0' && vkCode <= '9') {
                            keyStr = std::string(1, static_cast<char>(vkCode));
                        } else if (vkCode == VK_RETURN) {
                            keyStr = "ENTER";
                        } else if (vkCode == VK_LEFT) {
                            keyStr = "LEFT";
                        } else if (vkCode == VK_RIGHT) {
                            keyStr = "RIGHT";
                        } else if (vkCode == VK_UP) {
                            keyStr = "UP";
                        } else if (vkCode == VK_DOWN) {
                            keyStr = "DOWN";
                        }

                        if (!keyStr.empty()) {
                            auto callback = [keyStr](Napi::Env env, Napi::Function jsCallback) {
                                jsCallback.Call({Napi::String::New(env, keyStr)});
                            };
                            g_shortcutCallback.BlockingCall(callback);
                            OutputDebugStringA(("[KeyboardHook] Callback executed for key: " + keyStr).c_str());
                        }
                    } else {
                        OutputDebugStringA("[KeyboardHook] WARNING: No callback registered!");
                    }
                    // Allow the keydown to pass through
                    return CallNextHookEx(g_hHook, nCode, wParam, lParam);
                } else {
                    // Keyup: check if we tracked this key's keydown
                    std::lock_guard<std::mutex> lock(g_whitelistTrackingMutex);
                    if (g_whitelistKeysDown.find(vkCode) != g_whitelistKeysDown.end()) {
                        g_whitelistKeysDown.erase(vkCode);
                        OutputDebugStringA(("[KeyboardHook] Allowing whitelist keyup for: " + std::to_string(vkCode)).c_str());
                        // Allow the keyup to pass through
                        return CallNextHookEx(g_hHook, nCode, wParam, lParam);
                    }
                }
            }

            // If left Ctrl is down, block ANY other key (except whitelist above)
            if (g_blockLeftCtrl && g_leftCtrlDown && vkCode != VK_LCONTROL) {
                return 1; // Block any key pressed while left Ctrl is down
            }

            // If left Win is down, block ANY other key
            if (g_blockLeftCmd && g_leftWinDown && vkCode != VK_LWIN) {
                return 1; // Block any key pressed while left Win is down
            }

            // === STRATEGY 2: Track right Ctrl/Win separately ===
            if (vkCode == VK_RCONTROL) {
                g_rightCtrlDown = isKeyDown;
            }
            if (vkCode == VK_RWIN) {
                g_rightWinDown = isKeyDown;
            }

            // === STRATEGY 3: Legacy combo blocking (for backwards compatibility) ===
            // Check if this key should be blocked
            bool shouldBlock = false;
            {
                std::lock_guard<std::mutex> lock(g_keysMutex);
                shouldBlock = (g_blockedKeys.find(vkCode) != g_blockedKeys.end());
            }

            // Handle legacy Ctrl combo blocking (blocks right Ctrl too if enabled)
            if (g_blockCtrlCombos && shouldBlock) {
                // Don't block Ctrl keys themselves
                if (vkCode != VK_LCONTROL && vkCode != VK_RCONTROL && vkCode != VK_CONTROL) {
                    bool anyCtrlDown = g_leftCtrlDown || g_rightCtrlDown;
                    if (isKeyDown && anyCtrlDown) {
                        // This key is pressed while any Ctrl is down - track it and block
                        std::lock_guard<std::mutex> lock(g_trackingMutex);
                        g_keysDownWithModifier.insert(vkCode);
                        return 1; // Block the keydown
                    } else if (!isKeyDown) {
                        // This is a keyup - check if we tracked this key
                        std::lock_guard<std::mutex> lock(g_trackingMutex);
                        if (g_keysDownWithModifier.find(vkCode) != g_keysDownWithModifier.end()) {
                            // We blocked the keydown, so block the keyup too
                            g_keysDownWithModifier.erase(vkCode);
                            return 1; // Block the keyup
                        }
                    }
                }
            }

            // Handle legacy Win/Cmd combo blocking
            if (g_blockCmdCombos && shouldBlock) {
                // Don't block Win keys themselves
                if (vkCode != VK_LWIN && vkCode != VK_RWIN) {
                    bool anyWinDown = g_leftWinDown || g_rightWinDown;
                    if (isKeyDown && anyWinDown) {
                        // This key is pressed while any Win is down - track it and block
                        std::lock_guard<std::mutex> lock(g_trackingMutex);
                        g_keysDownWithModifier.insert(vkCode);
                        return 1; // Block the keydown
                    } else if (!isKeyDown) {
                        // This is a keyup - check if we tracked this key
                        std::lock_guard<std::mutex> lock(g_trackingMutex);
                        if (g_keysDownWithModifier.find(vkCode) != g_keysDownWithModifier.end()) {
                            // We blocked the keydown, so block the keyup too
                            g_keysDownWithModifier.erase(vkCode);
                            return 1; // Block the keyup
                        }
                    }
                }
            }
        }
    }

    // Pass to next hook
    return CallNextHookEx(g_hHook, nCode, wParam, lParam);
}

// Message loop thread
void MessageLoopThread() {
    MSG msg;
    while (g_isHookActive && GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
}

// Configure keys to block
Napi::Value ConfigureKeys(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Expected an object with configuration").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object config = info[0].As<Napi::Object>();

    // Read configuration for thorough left-side blocking
    if (config.Has("blockLeftCtrl")) {
        g_blockLeftCtrl = config.Get("blockLeftCtrl").As<Napi::Boolean>().Value();
    }

    if (config.Has("blockLeftCmd")) {
        g_blockLeftCmd = config.Get("blockLeftCmd").As<Napi::Boolean>().Value();
    }

    // Legacy configuration for backwards compatibility
    if (config.Has("blockCtrlCombos")) {
        g_blockCtrlCombos = config.Get("blockCtrlCombos").As<Napi::Boolean>().Value();
    }

    if (config.Has("blockCmdCombos")) {
        g_blockCmdCombos = config.Get("blockCmdCombos").As<Napi::Boolean>().Value();
    }

    // NEW: Configure whitelist keys (app shortcuts that should always work)
    if (config.Has("whitelistKeys") && config.Get("whitelistKeys").IsArray()) {
        Napi::Array whitelistKeys = config.Get("whitelistKeys").As<Napi::Array>();

        std::lock_guard<std::mutex> lock(g_whitelistMutex);
        g_whitelistKeys.clear();

        for (uint32_t i = 0; i < whitelistKeys.Length(); i++) {
            if (whitelistKeys.Get(i).IsString()) {
                std::string keyStr = whitelistKeys.Get(i).As<Napi::String>().Utf8Value();
                DWORD vkCode = 0;

                // Single letter or digit
                if (keyStr.length() == 1) {
                    char c = keyStr[0];
                    if (c >= 'A' && c <= 'Z') {
                        vkCode = c;
                    } else if (c >= '0' && c <= '9') {
                        vkCode = c;
                    }
                }
                // Special keys
                else if (keyStr == "ENTER" || keyStr == "Enter") {
                    vkCode = VK_RETURN;
                }
                else if (keyStr == "LEFT" || keyStr == "Left") {
                    vkCode = VK_LEFT;
                }
                else if (keyStr == "RIGHT" || keyStr == "Right") {
                    vkCode = VK_RIGHT;
                }
                else if (keyStr == "UP" || keyStr == "Up") {
                    vkCode = VK_UP;
                }
                else if (keyStr == "DOWN" || keyStr == "Down") {
                    vkCode = VK_DOWN;
                }

                if (vkCode != 0) {
                    g_whitelistKeys.insert(vkCode);
                }
            }
        }
    }

    if (config.Has("keys") && config.Get("keys").IsArray()) {
        Napi::Array keys = config.Get("keys").As<Napi::Array>();

        std::lock_guard<std::mutex> lock(g_keysMutex);
        g_blockedKeys.clear();

        for (uint32_t i = 0; i < keys.Length(); i++) {
            if (keys.Get(i).IsString()) {
                std::string keyStr = keys.Get(i).As<Napi::String>().Utf8Value();

                // Convert string to virtual key code
                DWORD vkCode = 0;

                // Single letter or digit
                if (keyStr.length() == 1) {
                    char c = keyStr[0];
                    if (c >= 'A' && c <= 'Z') {
                        vkCode = c;
                    } else if (c >= '0' && c <= '9') {
                        vkCode = c;
                    }
                } else {
                    // Special keys
                    if (keyStr == "Space") vkCode = VK_SPACE;
                    else if (keyStr == "Tab") vkCode = VK_TAB;
                    else if (keyStr == "Enter") vkCode = VK_RETURN;
                    else if (keyStr == "Backspace") vkCode = VK_BACK;
                    else if (keyStr == "Delete") vkCode = VK_DELETE;
                    else if (keyStr == "Escape") vkCode = VK_ESCAPE;
                    else if (keyStr == "Left") vkCode = VK_LEFT;
                    else if (keyStr == "Right") vkCode = VK_RIGHT;
                    else if (keyStr == "Up") vkCode = VK_UP;
                    else if (keyStr == "Down") vkCode = VK_DOWN;
                    else if (keyStr == "Home") vkCode = VK_HOME;
                    else if (keyStr == "End") vkCode = VK_END;
                    else if (keyStr == "PageUp") vkCode = VK_PRIOR;
                    else if (keyStr == "PageDown") vkCode = VK_NEXT;
                    else if (keyStr == "Insert") vkCode = VK_INSERT;
                    else if (keyStr == "Plus") vkCode = VK_OEM_PLUS;
                    else if (keyStr == "Minus") vkCode = VK_OEM_MINUS;
                    else if (keyStr == "Equal") vkCode = VK_OEM_PLUS;
                    else if (keyStr.length() >= 2 && keyStr[0] == 'F') {
                        int fNum = std::stoi(keyStr.substr(1));
                        if (fNum >= 1 && fNum <= 12) {
                            vkCode = VK_F1 + (fNum - 1);
                        }
                    }
                }

                if (vkCode != 0) {
                    g_blockedKeys.insert(vkCode);
                }
            }
        }
    }

    return Napi::Boolean::New(env, true);
}

// Enable keyboard hook
Napi::Value EnableHook(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (g_isHookActive) {
        return Napi::Boolean::New(env, true);
    }

    // Store our own process ID for passthrough check
    g_ownProcessId = GetCurrentProcessId();

    // Install low-level keyboard hook
    g_hHook = SetWindowsHookEx(
        WH_KEYBOARD_LL,
        LowLevelKeyboardProc,
        GetModuleHandle(NULL),
        0
    );

    if (g_hHook == NULL) {
        Napi::Error::New(env, "Failed to install keyboard hook").ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }

    g_isHookActive = true;

    // Start message loop thread
    g_messageThread = std::thread(MessageLoopThread);

    return Napi::Boolean::New(env, true);
}

// Disable keyboard hook
Napi::Value DisableHook(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_isHookActive) {
        return Napi::Boolean::New(env, true);
    }

    g_isHookActive = false;

    // Reset all tracking states
    g_leftCtrlDown = false;
    g_rightCtrlDown = false;
    g_leftWinDown = false;
    g_rightWinDown = false;
    g_ownProcessId = 0;  // Clear process ID
    {
        std::lock_guard<std::mutex> lock(g_trackingMutex);
        g_keysDownWithModifier.clear();
    }
    {
        std::lock_guard<std::mutex> lock(g_whitelistMutex);
        g_whitelistKeys.clear();
    }
    {
        std::lock_guard<std::mutex> lock(g_callbackMutex);
        if (g_shortcutCallback) {
            g_shortcutCallback.Release();
        }
    }

    // Uninstall hook
    if (g_hHook != NULL) {
        UnhookWindowsHookEx(g_hHook);
        g_hHook = NULL;
    }

    // Send quit message to message loop
    PostThreadMessage(GetThreadId(g_messageThread.native_handle()), WM_QUIT, 0, 0);

    // Wait for thread to finish
    if (g_messageThread.joinable()) {
        g_messageThread.join();
    }

    return Napi::Boolean::New(env, true);
}

// Check hook status
Napi::Value IsHookActive(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::Boolean::New(env, g_isHookActive);
}

// Set callback for whitelist shortcuts
Napi::Value SetShortcutCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Function expected as argument").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Function callback = info[0].As<Napi::Function>();

    std::lock_guard<std::mutex> lock(g_callbackMutex);

    // Release old callback if exists
    if (g_shortcutCallback) {
        g_shortcutCallback.Release();
    }

    // Create new thread-safe function
    g_shortcutCallback = Napi::ThreadSafeFunction::New(
        env,
        callback,
        "ShortcutCallback",
        0,  // unlimited queue
        1   // only one thread will use this
    );

    return Napi::Boolean::New(env, true);
}

// Module initialization
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "enableHook"), Napi::Function::New(env, EnableHook));
    exports.Set(Napi::String::New(env, "disableHook"), Napi::Function::New(env, DisableHook));
    exports.Set(Napi::String::New(env, "isHookActive"), Napi::Function::New(env, IsHookActive));
    exports.Set(Napi::String::New(env, "configureKeys"), Napi::Function::New(env, ConfigureKeys));
    exports.Set(Napi::String::New(env, "setShortcutCallback"), Napi::Function::New(env, SetShortcutCallback));
    return exports;
}

NODE_API_MODULE(keyboard_hook, Init)