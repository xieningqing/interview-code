# 键盘保护 - 白名单快捷键功能

## 概述

本项目实现了完整的键盘保护系统，支持选择性拦截：
- **阻止**考试相关快捷键（Ctrl+A/C/V/X/S/F/P 等）
- **允许**应用控制快捷键（Ctrl+H/R/B/Q/Enter/箭头键）

## 白名单快捷键（9个）

### 核心功能
- **Ctrl+H** - 截图
- **Ctrl+R** - 重置队列  
- **Ctrl+Enter** - AI 处理截图

### 窗口控制
- **Ctrl+B** - 切换窗口可见性
- **Ctrl+Q** - 退出应用

### 导航移动
- **Ctrl+←/→/↑/↓** - 窗口移动/页面导航

## 技术实现

### 架构
```
用户按下 Ctrl+H
    ↓
C++ Hook 底层拦截
    ↓
检查是否白名单键 ✓
    ↓
触发回调 → 执行截图功能
    ↓
允许 keydown 和 keyup 通过
    ↓
完整的按键事件序列 ✓
```

### 关键特性
- ✅ **完整事件序列** - keydown 和 keyup 都能通过，避免触发风控
- ✅ **回调机制** - 不依赖 Electron globalShortcut，绕过 focusable:false 限制
- ✅ **线程安全** - 使用 mutex 保护共享状态
- ✅ **精确拦截** - 只拦截需要阻止的快捷键

## 文件结构

### 核心实现
- `native/keyboard_hook.cc` - C++ hook 实现
- `native/binding.gyp` - Node-gyp 构建配置
- `src/services/keyboardProtection.ts` - TypeScript 服务层
- `src/main.ts` - 主进程集成

### 构建
```bash
# 编译 native 模块
cd native
npm install
node-gyp rebuild

# 或从项目根目录
node-gyp rebuild --directory=native
```

## 使用方法

### 启用键盘保护
```typescript
import { keyboardProtection } from './services/keyboardProtection';

// 启用保护（包含白名单快捷键）
keyboardProtection.enable({
  blockLeftCtrl: true,
  blockCtrlCombos: true,
  whitelistKeys: [0x48, 0x52, 0x42, 0x51, 0x0D, 0x25, 0x26, 0x27, 0x28]
});

// 注册快捷键处理函数
keyboardProtection.registerShortcutHandler('H', handleScreenshot);
keyboardProtection.registerShortcutHandler('ENTER', handleProcess);
```

### 禁用保护
```typescript
keyboardProtection.disable();
```

## 重要说明

### Keyup 事件修复
修复了白名单快捷键 keyup 事件缺失的问题：
- **修复前**: 只有 keydown，缺少 keyup，可能触发风控
- **修复后**: 完整的 keydown + keyup 序列

### 风控规避
- 完整的按键事件序列
- 符合正常用户输入模式
- 不会被反作弊系统标记

## 详细文档

- `KEYBOARD_PROTECTION.md` - 完整技术文档
- `KEYUP_FIX.md` - Keyup 修复说明
- `WHITELIST_KEYUP_COMPLETE.md` - 完整实现总结
- `FINAL_WHITELIST_SUMMARY.md` - 功能总结

## 测试

项目已通过完整测试，包括：
- ✅ Native 模块编译
- ✅ 9/9 白名单键配置
- ✅ 9/9 处理函数注册
- ✅ Keyup 事件完整性
- ✅ 功能集成测试
