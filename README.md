# interview-code - Invisible AI-Powered Interview Assistant

A powerful, completely invisible AI tool for solving Coding questions during technical interviews. The tool runs 100% undetectably in the background - no screen recording or monitoring software can identify its presence.

Open-source Alternative to Interview Coder

## Demo
https://github.com/user-attachments/assets/179701eb-0fcf-4e33-86f3-c92688f508a5

## Features

- 🔒 100% Undetectable - Completely invisible to all screen recording and monitoring software
- 🤖 Real-time AI assistance for solving Coding problems
- 🌐 Support for multiple programming languages
- 🎯 Precise, contextual coding suggestions
- ⚙️ Configuration through a `.env` file

### Local Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/crackcode.git
   cd crackcode
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   - Copy `.env.example` to `.env`
   - Add your API key
   - Choose an OpenAI-compatible base URL if needed
   - Set the model name
   - Set your preferred programming language

4. Start the application:
   ```bash
   npm start
   ```

## Prerequisites

- Node.js (v14 or higher) - only for local setup
- npm (Node Package Manager) - only for local setup
- OpenAI API key

## Configuration

For `npm start`, create a `.env` file in the project root directory. For a packaged Windows app, create a `.env` file next to `interview-code.exe`; the app loads this external file on every launch.

The Windows release download contains exactly two files: the portable executable and `.env.example`. Copy `.env.example` to `.env`, fill in your settings, and keep it beside the executable.

```text
interview-code.exe
.env
```

Use the following settings:
```env
OPENAI_API_KEY="your-api-key-here"
OPENAI_BASE_URL="https://open.bigmodel.cn/api/paas/v4/"
OPENAI_MODEL="GLM-4.1V-Thinking-Flash"
OPENAI_THINKING="disabled"
OPENAI_MAX_TOKENS="8192"
APP_LANGUAGE="Java"  # Or Python, JavaScript, C++, etc.
```

### Thinking / reasoning models

Many current vision models are *reasoning* models: before writing the answer they
stream a long internal reasoning pass, and **that pass is billed against
`OPENAI_MAX_TOKENS`**. With a small budget the model can consume every token while
still thinking and return no answer at all, which surfaces in the app as
`Model returned an empty or non-JSON response`.

Set `OPENAI_THINKING="disabled"` to answer directly (also much faster), and keep
`OPENAI_MAX_TOKENS` high enough for a complete solution. If the provider rejects the
`thinking` parameter the app retries without it automatically.

The app also retries by itself: an empty first attempt is repeated once with a doubled
token budget, then once more without streaming/JSON mode.

### Nothing the model says is thrown away

If the response cannot be parsed as JSON, the full model output is still shown instead
of an error:

- Code fences are collected into the **Solution** pages, the remaining text becomes the
  **Raw output (unparsed)** pages (22 lines per page, `Ctrl/Cmd + ←/→` to page through).
- Markdown answers with several code blocks keep every block and every paragraph.
- Text outside an otherwise valid JSON object is appended rather than dropped.
- If the model produced no answer at all, only its internal reasoning is shown, clearly
  labelled as reasoning so it is not mistaken for the answer.

The parsing rules are covered by deterministic tests: `npm run test:parsing`.

## Usage

Start the application:
```bash
npm start
```

## Shortcuts

### General Shortcuts

- **Screenshot**: ⌘/Ctrl + H
- **Solution**: ⌘/Ctrl + ↵/Enter
- **Reset**: ⌘/Ctrl + R
- **Show/Hide**: ⌘/Ctrl + B
- **Quit**: ⌘/Ctrl + Q
- **Move Around**: ⌘/Ctrl + Arrow Keys

## Contributing
We welcome contributions! Please feel free to submit a Pull Request.

## Support
If you find this tool helpful, please consider giving it a star ⭐️
