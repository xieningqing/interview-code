# 打包 Native 模块说明

## 问题

Electron 应用打包时，native 模块（`.node` 文件）需要特殊处理，否则打包后的 exe 无法正常加载键盘 hook 功能。

## 解决方案

### 1. **package.json 配置**

```json
"build": {
  "files": [
    "dist/**/*",
    "native/build/Release/*.node",  // 包含编译后的 .node 文件
    "native/index.js",
    "native/package.json",
    "package.json"
  ],
  "asarUnpack": [
    "native/**/*"  // 关键：不要将 native 模块打包进 asar 归档
  ]
}
```

**为什么需要 `asarUnpack`？**
- Electron 默认将所有文件打包进 `app.asar` 归档
- `.node` 二进制文件必须以解压状态存在才能被 Node.js 加载
- `asarUnpack` 告诉 electron-builder 将这些文件解压到 `app.asar.unpacked/` 目录

### 2. **动态路径解析**

在 `src/services/keyboardProtection.ts` 中，使用多路径尝试加载：

```typescript
function loadNativeModule(): KeyboardHookNative | null {
  const possiblePaths = [
    // 开发环境：从 dist/services/ 到 native/build/Release/
    path.join(__dirname, '../../native/build/Release/keyboard_hook.node'),
    
    // 打包后：从 app.asar 到 app.asar.unpacked
    path.join(__dirname, '../../native/build/Release/keyboard_hook.node')
      .replace('app.asar', 'app.asar.unpacked'),
    
    // 备用路径：直接使用 resources 目录
    path.join(process.resourcesPath, 'native/build/Release/keyboard_hook.node'),
  ];

  for (const nativePath of possiblePaths) {
    try {
      keyboardHook = require(nativePath);
      console.log('Loaded from:', nativePath);
      return keyboardHook;
    } catch (err) {
      continue;
    }
  }
}
```

## 打包流程

### Windows 打包

```bash
# 1. 编译 native 模块（如果还没编译）
cd native
npm install
node-gyp rebuild
cd ..

# 2. 构建 TypeScript 代码
npm run build

# 3. 打包成 exe
npm run dist:win
```

### 打包后的目录结构

```
interview-code-v1.0.0-win-x64-portable.exe
  └─ (解压后)
     ├─ resources/
     │  ├─ app.asar                    # 主应用代码（已压缩）
     │  │  ├─ dist/
     │  │  │  └─ services/
     │  │  │     └─ keyboardProtection.js
     │  │  └─ package.json
     │  └─ app.asar.unpacked/          # 解压的文件
     │     └─ native/
     │        └─ build/
     │           └─ Release/
     │              └─ keyboard_hook.node  ← 关键文件
     └─ interview-code.exe
```

## 验证打包

### 测试打包后的应用

1. 运行打包后的 exe
2. 打开 DevTools (Ctrl+Shift+I)
3. 查看控制台输出：
   ```
   [KeyboardProtection] Native module loaded successfully from: C:\...\app.asar.unpacked\native\build\Release\keyboard_hook.node
   ```
4. 测试快捷键：
   - Ctrl+H 应该能截图 ✓
   - Ctrl+A 在外部应用中应该被阻止 ✓

### 常见问题

**问题 1：打包后提示 "Failed to load native module"**
- 检查 `app.asar.unpacked/native/build/Release/` 目录是否存在
- 检查 `keyboard_hook.node` 文件是否存在
- 查看控制台完整错误信息

**问题 2：打包文件太大**
- `native/build/` 目录包含很多中间文件
- 只需要 `Release/*.node` 文件
- 可以在打包前清理：`npm run build && npm run dist:win`

**问题 3：不同机器上无法运行**
- `.node` 文件是平台特定的
- Windows 需要 Visual Studio Build Tools
- 确保目标机器有 VC++ Redistributable

## 其他平台

### macOS 打包

```bash
npm run dist:mac
```

macOS 上需要重新编译 native 模块（当前只实现了 Windows hook）。

## 自动化打包脚本

可以创建一个打包前检查脚本：

```bash
# scripts/pre-pack.js
const fs = require('fs');
const path = require('path');

const nativeModule = 'native/build/Release/keyboard_hook.node';

if (!fs.existsSync(nativeModule)) {
  console.error('❌ Native module not found!');
  console.log('Run: cd native && node-gyp rebuild && cd ..');
  process.exit(1);
}

console.log('✅ Native module exists');
console.log('✅ Ready to pack');
```

在 package.json 中添加：
```json
"scripts": {
  "prepack": "node scripts/pre-pack.js",
  "predist": "node scripts/pre-pack.js"
}
```

## 总结

✅ **已配置**：
- `package.json` 包含 native 文件路径
- `asarUnpack` 确保 .node 文件解压
- 动态路径解析支持开发和打包环境

✅ **打包命令**：
```bash
npm run dist:win
```

✅ **验证方法**：
- 检查打包后目录结构
- 运行 exe 查看控制台日志
- 测试快捷键功能
