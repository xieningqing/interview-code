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
- macOS build: `interview-code-v1.0.0-mac-x64.dmg` and `interview-code-v1.0.0-mac-x64.zip`
