---
name: Expo web feedback
description: Critical customer outcomes need rendered feedback, not native alerts alone.
---
Do not rely on React Native `Alert.alert` as the sole feedback for critical Companion browser outcomes.

**Why:** A prepared browser checkout returned a saved-but-unresolved outcome without displaying its native alert, leaving the submit button visible and the customer uninformed.

**How to apply:** Show validation, pending confirmations and safety warnings in rendered text or a cross-platform modal. Native alerts may supplement that feedback, not replace it.