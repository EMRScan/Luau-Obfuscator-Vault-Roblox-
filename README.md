# Luau Obfuscator Vault

A tiny local web page that turns Roblox Studio (Luau) scripts into runnable obfuscated Luau.

- Obfuscation: minifies + renames local variables/parameters (best-effort)
- Restore: generates a vault key that lets you retrieve your original script later from this browser (stored locally)

No uploads. No server.

## Use

1. Open `index.html` in a modern browser.
2. Paste your script in **Obfuscate** and click **Obfuscate**.
3. Copy the **Obfuscated Output** and paste it into Roblox Studio.
4. Copy the **Vault Key** if you want to restore your original later.
5. To restore: go to **Restore**, paste the key, click **Restore Original**.

Tip: Press `Ctrl+Enter` (or `Cmd+Enter` on Mac) to run the active panel.

## Notes

- The vault key works only in the same browser profile where it was generated. If you clear site data or use another device, it cannot restore.
- If your script contains Luau backtick strings (interpolation), local renaming is disabled to avoid breaking the embedded expressions. Output is still minified.
- Obfuscation is best-effort. Always test the output in Studio.
- Use this for protecting your own scripts. Don’t use it to hide malicious code.
