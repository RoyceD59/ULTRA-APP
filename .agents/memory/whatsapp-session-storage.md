---
name: WhatsApp session storage
description: Where Baileys session credentials live and the git-history leak caveat.
---

- Session credential files live OUTSIDE the repo: default `~/.uc-whatsapp-session`, overridable with `WHATSAPP_SESSION_DIR`. Production additionally mirrors them to Object Storage (`WHATSAPP_SESSION_BUCKET_PATH`, defaults to the default bucket in prod).
- A startup check (`migrateAndGuardSessionDir`) migrates any legacy in-repo `.whatsapp-session` files out and prints a loud security warning if credentials are ever found inside the working tree.
- **Why:** the files were once committed and git history still contains them. History rewriting was declined; the production session was logged out, re-linked, and confirmed connected on September 13, 2026, invalidating the historical credentials.
- **How to apply:** never point `WHATSAPP_SESSION_DIR` inside the repo; keep the `.gitignore` rule; treat any new in-repo session files as an incident. Do not describe the remaining historical blobs as live credentials.

- Do not assume the preview's WhatsApp session storage is isolated from the published service. Confirm the target instance and storage isolation before any operational reset; UI recovery tests should mock all WhatsApp operations.
- **Why:** the preview has been observed restoring a configured remote WhatsApp session despite the documented local-only development default. Resetting the preview is not a safe substitute for resetting production.
- **How to apply:** use the target's existing authorized team session for real disconnect/connect operations; never delete preview session files or remote objects as a shortcut to a live reset.

- Production session persistence across republishing has been confirmed by the user: WhatsApp reconnected without another QR scan.
- **Why:** restoring stored files alone does not establish that WhatsApp accepts the session after container replacement; the user confirmed the live reconnect after being asked to republish.
- **How to apply:** preserve the established pairing for future deployment checks. Distinguish a full republish from pressing Connect; use storage checks as supporting evidence, not a substitute for live connection status.

- Session-backup retry approval is not permission to reset/re-pair the real session or test failures against its live storage prefix.
- **Why:** The owner approved bounded per-file transient upload recovery on 2026-10-10; the assignment explicitly required isolated storage tests and preserving disconnect protections.
- **How to apply:** Use injected synthetic storage for failure/race checks. Keep operational session changes and actual production publication/verification separately authorized.
