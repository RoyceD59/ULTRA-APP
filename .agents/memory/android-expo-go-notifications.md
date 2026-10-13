---
name: Android Expo Go notification imports
description: Remote-push guards must protect module evaluation, not just token requests.
---

Keep the remote Expo notification entry point out of local-notification startup.
Android Expo Go no longer supports remote push from SDK 53 onward.

**Why:** The SDK evaluates remote token-listener registration during the bare
notification-module import and throws before the application's existing
remote-token guard runs. A user supplied the resulting Android startup error;
guards around token requests alone were insufficient.

**How to apply:** Preserve local reminders and notification routing through
local-only entry points; load remote registration only after checking runtime
support. Recheck their transitive import graph when upgrading Expo because the
local entry points are SDK-specific. Do not hide the error with LogBox filtering
or disable all local reminders merely to avoid the remote-push import.
