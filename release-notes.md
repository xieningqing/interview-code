## interview-code v1.1.0

### Features
- **Whitelist Shortcuts System**: Quick keyboard shortcuts for managing process whitelist
  - `Alt+Shift+1`: Add current foreground window to whitelist
  - `Alt+Shift+2`: Remove current foreground window from whitelist  
  - `Alt+Shift+3`: Toggle whitelist status display
- **Automatic Whitelist Management**: Visual feedback and persistent storage
- **Documentation Reorganization**: Cleaner project structure with organized docs

### Improvements
- Fixed GitHub Actions CI/CD for native module compilation
- Properly configured Visual Studio Build Tools for Windows builds
- Added native module verification in build pipeline
- Reorganized documentation into logical directories (guides, development, archive)

### Technical Changes
- Install `visualstudio2022-workload-vctools` via Chocolatey in CI
- Configure node-gyp with explicit VS 2022 version
- Removed redundant environment variables and simplified build steps
- Cleaned up root directory from 27+ markdown files to 2 core docs

### Configuration
- Copy `.env.example` to `.env` after downloading the app
- Fill in `OPENAI_API_KEY` and `OPENAI_MODEL` before launching
- Optional settings include `OPENAI_BASE_URL`, `OPENAI_MAX_TOKENS`, and `APP_LANGUAGE`

### Artifacts
- Windows x64 portable app: `interview-code-v1.1.0-win-x64-portable.exe`
- Environment template: `.env.example` (copy to `.env` next to the portable executable)
- macOS build: `interview-code-v1.1.0-mac-x64.zip`

---

## interview-code v1.0.0

### What's Included
- Added packaged app configuration support through external `.env` files.
- Included `.env.example` in packaged builds so users can create their own runtime `.env` next to the app executable.
- Supports OpenAI-compatible API configuration with custom base URL, model, max tokens, and preferred programming language.
- Builds Windows and macOS release artifacts through GitHub Actions.

### Configuration
- Copy `.env.example` to `.env` after downloading the app.
- Fill in `OPENAI_API_KEY` and `OPENAI_MODEL` before launching.
- Optional settings include `OPENAI_BASE_URL`, `OPENAI_MAX_TOKENS`, and `APP_LANGUAGE`.

### Artifacts
- Windows x64 portable app: `interview-code-v1.0.0-win-x64-portable.exe`
- Environment template: `.env.example` (copy to `.env` next to the portable executable)
- macOS build: `interview-code-v1.0.0-mac-x64.zip`
