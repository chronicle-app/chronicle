---
'@chronicle.app/cli': patch
'@chronicle.app/arc-timeline': patch
'@chronicle.app/call-history': patch
---

Arc Timeline and Apple Call History run under their plugins' names: `chronicle extract arc-timeline` and `chronicle extract call-history`, instead of `arc` and `apple-phone`. Their records keep the `arc` and `apple-phone` namespaces, so calls still fold with Timing's. The `sources` table names the plugin where it matters: the one to install when its name differs from the source's, which local plugin is running a source, and which package outside the catalog provides one.
