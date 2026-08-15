---
name: WhatsApp session storage
description: Where Baileys session credentials live and the git-history leak caveat.
---

- Session credential files live OUTSIDE the repo: default `~/.uc-whatsapp-session`, overridable with `WHATSAPP_SESSION_DIR`. Production additionally mirrors them to Object Storage (`WHATSAPP_SESSION_BUCKET_PATH`, defaults to the default bucket in prod).
- A startup check (`migrateAndGuardSessionDir`) migrates any legacy in-repo `.whatsapp-session` files out and prints a loud security warning if credentials are ever found inside the working tree.
- **Why:** the files were once committed; git history still contains old session credentials. If the repo is ever pushed/shared publicly, the WhatsApp session must be re-linked (logout + re-scan QR) to invalidate them.
- **How to apply:** never point `WHATSAPP_SESSION_DIR` inside the repo; keep the `.gitignore` rule; treat any in-repo session files as an incident.
