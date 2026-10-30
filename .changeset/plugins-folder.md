---
'@chronicle.app/cli': minor
---

`chronicle plugins install` puts plugins in `plugins` in the Chronicle data folder, beside the store: `~/Library/Application Support/Chronicle/plugins` on macOS, and `~/.local/share/chronicle/plugins` elsewhere (`%LOCALAPPDATA%\chronicle\plugins` on Windows). Plugins installed before stay where they are, and still load and uninstall.
