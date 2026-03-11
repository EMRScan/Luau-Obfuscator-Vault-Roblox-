# Luau Obfuscator Vault

A tiny, static (no backend) web tool that turns Roblox Studio Luau scripts into **runnable obfuscated Luau** by:
- Minifying whitespace/comments
- Renaming **local variables and function parameters** (best-effort)

It also generates a **Vault Key** so you can retrieve your original script later from the same browser (stored locally).

## Quick Start

1. Download this repo (or clone it).
2. Open `index.html` in a modern browser (Chrome/Edge/Firefox).
3. Paste your script in **Obfuscate**.
4. Click **Obfuscate**.
5. Copy the **Obfuscated Output** and paste it into Roblox Studio.

To restore your original later:
1. Copy the **Vault Key** after obfuscating.
2. Go to **Restore**, paste the key, click **Restore Original**.

Tip: `Ctrl+Enter` (or `Cmd+Enter`) runs the active tab.

## What The Vault Key Is (and isn’t)

- The Vault Key is **not** a decryption key.
- It’s just an ID to look up your original script saved in **your browser’s localStorage**.
- Keys only work in the **same browser profile** on the **same device**. If you clear site data, switch browsers, or use another computer, restore will not work.

## Limitations (Read This)

- Obfuscation is **best-effort**, not unbreakable. Determined reverse-engineering is possible.
- If your script uses **Luau backtick strings** (string interpolation), the tool disables local renaming to avoid breaking embedded expressions (it still minifies).
- This tool does not currently do advanced control-flow obfuscation, string encryption, or VM-style obfuscation.

## Privacy

- Runs locally in your browser.
- No uploads, no tracking, no server.
- “Restore” uses localStorage in your browser only.

## Troubleshooting

If opening `index.html` directly causes issues in your browser, run a simple local server in the repo folder:

```bash
python -m http.server 8000
