---
name: Page loader presentation
description: User's visual choice for shared Companion page-data loading feedback.
---

Use the user's supplied glossy blue falling-droplet/ripple artwork beside the existing visible loading text. Use the supplied static droplet for reduced motion and error feedback.

**Why:** The user chose to keep visible loading text when changing from three droplets to one, then explicitly requested applying the uploaded falling-water artwork.

**How to apply:** This applies to shared Companion page-data loaders, not payment/submission spinners, launch splash screens, app icons, or ProjectHub.

Preserve the supplied artwork's partial transparency and inspect the encoded
animation, not only its source frames.

**Why:** GIF's binary alpha erased the faint waves; alpha dithering introduced
visible speckling in the glossy drop. Lossless animated WebP preserves the
intended gradients and ripple fade using the existing Expo Image component.

**How to apply:** Keep the PNG still alternative and motion gates, and check
actual decoded output whenever changing image format or generation settings.