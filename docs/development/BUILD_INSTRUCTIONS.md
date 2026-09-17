# 打包指南 - Interview Code

## 📦 打包命令

### Windows 打包（推荐）
```bash
npm run dist:win
```
这会：
1. ✅ 自动验证 native 模块是否存在
2. ✅ 编译 TypeScript 代码
3. ✅ 打包成 **portable.exe**（单文件可执行程序）
4. ✅ 复制 .env.example 到输出目录
5. ✅ 输出位置：`release/interview-code-portable.exe`

### macOS 打包
```bash
npm run dist:mac
```
输出：`release/interview-code-v1.0.0-mac-x64.zip`

### 通用打包（所有平台）
```bash
npm run dist
```
会根据当前操作系统自动选择平台

---

## ⚠️ 打包前的准备

### 1. 确保 Native 模块已编译
```bash
# 检查文件是否存在
ls native/build/Release/keyboard_hook.node
```

如果不存在，先编译：
```bash
cd native
node-gyp rebuild
cd ..
```

### 2. 确保依赖已安装
```bash
npm install
```

---

## 🔍 打包过程详解

### `npm run dist:win` 执行顺序

#### 步骤 1: Pre-build 验证 (自动)
```
Running: node scripts/verify-native-module.js
✓ Native module found
```

#### 步骤 2: 编译 TypeScript
```
Running: npm run build
- tsc (编译 TypeScript)
- webpack (打包 renderer)
```

#### 步骤 3: Electron Builder
```
Running: electron-builder --win portable --x64
- 创建 portable.exe
- 包含 native/build/Release/keyboard_hook.node
- 配置 asarUnpack 确保 native 模块可加载
```

#### 步骤 4: 后处理
```
Running: node scripts/copy-env-example.js
- 复制 .env.example 到 release 目录
```

---

## 📁 输出目录结构

### Windows
```
release/
├── interview-code-portable.exe    ← 主程序（包含所有内容）
└── .env.example                   ← 配置文件示例
```

### 内部结构（解压后）
```
interview-code-portable.exe
└─ resources/
   ├─ app.asar                     ← 应用代码（压缩）
   └─ app.asar.unpacked/           ← Native 模块（未压缩）
      └─ native/
         └─ build/
            └─ Release/
               └─ keyboard_hook.node  ← 键盘 Hook
```

---

## ✅ 验证打包结果

### 1. 检查文件大小
```bash
ls -lh release/interview-code-portable.exe
# 应该约 100-200 MB
```

### 2. 运行并检查控制台
```bash
cd release
./interview-code-portable.exe
```

应该看到：
```
✓ Native module loaded successfully
  Path: C:\...\resources\app.asar.unpacked\native\build\Release\keyboard_hook.node
```

### 3. 测试快捷键
- ✅ Ctrl+H → 截图功能
- ✅ Ctrl+R → 重置队列
- ✅ Ctrl+B → 切换可见性
- ✅ Ctrl+Q → 退出应用
- ❌ Ctrl+A/C/V → 被阻止（在考试环境中）

---

## 🚨 常见问题

### 问题 1: "Native module not found"
**原因**：native 模块未编译

**解决**：
```bash
cd native
node-gyp rebuild
cd ..
npm run dist:win
```

### 问题 2: 打包很慢
**原因**：node_modules 太大

**解决**：
```bash
# 清理后重新安装
rm -rf node_modules
npm install
npm run dist:win
```

### 问题 3: exe 运行时找不到 keyboard_hook.node
**原因**：asarUnpack 配置问题

**检查**：package.json 中应该有：
```json
"build": {
  "asarUnpack": [
    "native/build/Release/*.node"
  ]
}
```

### 问题 4: 快捷键不工作
**检查清单**：
1. Native 模块是否加载成功（看控制台）
2. 是否在管理员模式下运行（Windows 可能需要）
3. keyboardProtection.enable() 是否被调用

---

## 🎯 快速打包流程

### 完整流程（从零开始）
```bash
# 1. 安装依赖
npm install

# 2. 编译 native 模块
cd native
node-gyp rebuild
cd ..

# 3. 打包
npm run dist:win

# 4. 测试
cd release
./interview-code-portable.exe
```

### 快速打包（已准备好）
```bash
npm run dist:win
```
就这么简单！✨

---

## 📊 打包时间估算

| 步骤 | 时间 |
|------|------|
| 验证 native 模块 | < 1秒 |
| 编译 TypeScript | 5-10秒 |
| Electron Builder | 30-60秒 |
| 后处理脚本 | < 1秒 |
| **总计** | **约 1 分钟** |

---

## 🔧 不同的打包选项

### 开发测试（不打包）
```bash
npm run dev
# 直接运行，不创建 exe
```

### 打包到目录（快速测试）
```bash
npm run pack
# 输出到 dist/ 目录，不压缩成单文件
```

### 完整打包（生产环境）
```bash
npm run dist:win
# 创建 portable.exe
```

---

## 📝 打包前检查清单

- [ ] Native 模块已编译（`native/build/Release/keyboard_hook.node` 存在）
- [ ] 依赖已安装（`node_modules` 存在）
- [ ] .env 文件配置正确（OpenAI API key 等）
- [ ] package.json version 已更新
- [ ] 所有代码已提交到 git

---

## 🎉 成功标志

打包成功后，你应该看到：

```
✓ Native module verification passed
✓ Build completed successfully
✓ Creating portable.exe...
✓ Build complete!

Output: release/interview-code-portable.exe
```

现在可以分发这个 exe 文件了！🚀
