---
name: React Native Web heading and accordion semantics
description: Web renderer behavior affecting public heading levels and accordion expanded state.
---

Use explicit web heading levels with the native header role. For accordion headings, place the web heading outside the button rather than placing a heading inside a button.

**Why:** React Native Web maps the header role plus `aria-level` to a real heading element. Heading descendants inside buttons can lose their independent semantics, so a styled section title inside a button is not enough.

**How to apply:** Keep native heading roles and add levels only to the web renderer; preserve named button controls within web heading wrappers.

Send `aria-expanded` explicitly for web accordion controls, even when native `accessibilityState.expanded` is supplied.

**Why:** The installed React Native Web renderer did not emit expanded state from `accessibilityState` in a server-rendered TouchableOpacity, but did emit it from `aria-expanded`. Native accessibility state and web attributes are not interchangeable in every supported renderer.

**How to apply:** Check emitted DOM with the installed renderer rather than assuming all native accessibility-state props reach browser markup.