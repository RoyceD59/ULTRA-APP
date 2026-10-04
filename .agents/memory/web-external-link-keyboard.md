---
name: Web external-link keyboard activation
description: Why React Native Web external link controls need real hrefs as well as link roles.
---

React Native Web treats controls with the link role as browser-native interactive elements and does not synthesize their Enter-key press callback. Give external links a real web-only href; prevent default navigation when the press handler instead uses Linking so opening failures can be shown without opening twice.

**Why:** A focusable touchable with only a link role can respond to clicks but silently do nothing on Enter. Native anchors provide the browser activation behavior.

**How to apply:** When adding external link controls, check the installed React Native Web press responder behavior. Keep href and tabIndex web-only and preserve native Linking behavior.