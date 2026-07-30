# Spoor 雪泥 v0.1.0 — Release notes

## Download (Windows)

| Asset | Description |
|-------|-------------|
| **Spoor_0.1.0_x64-setup.exe** | Recommended — NSIS installer, 64-bit Windows 10/11 |

**Install:** run the `.exe` → follow the wizard → open **Spoor** from the Start menu.

**Latest release:** https://github.com/iimorning/spoor/releases/latest

---

## What is Spoor?

Local-first spatial canvas for notes, AI personas, deep research, and long-form drafts. Your canvas data stays on your device (IndexedDB).

---

## First launch

1. Open **Settings** and choose an AI provider (Gemini, OpenAI-compatible, etc.).
2. Paste your API key — stored only on this machine.
3. Optional: enable local GGUF via llama.cpp — see [LOCAL_LLM.md](./LOCAL_LLM.md) (not bundled in the installer).

---

## Web vs desktop

| | Web (Netlify) | Desktop (this release) |
|---|---------------|------------------------|
| Install | Browser only | One-click `.exe` |
| Data | Browser IndexedDB | `%LOCALAPPDATA%\com.spoor.app\` |
| Metaso / some APIs | Needs Netlify redirects | Native Tauri proxy |

---

## Upgrading from SpatialNotes (`com.spatialnodes.app`)

If you used an older desktop build, data may still be under `%LOCALAPPDATA%\com.spatialnodes.app\`. Migration: [DATA_RECOVERY.md](./DATA_RECOVERY.md).

---

## License

[PolyForm Noncommercial License 1.0.0](../LICENSE) — personal and noncommercial use. Commercial use requires permission from the author.

---

## Build info

- Version: **0.1.0**
- Tauri identifier: `com.spoor.app`
- Built with GitHub Actions workflow `release-desktop.yml` (Windows NSIS)
