---
'@chronicle.app/cli': patch
---

Live progress no longer flashes as it redraws. Each frame is written over the last in one write, instead of clearing the lines and then drawing them again, and it's marked as one update for terminals that support synchronized output.
