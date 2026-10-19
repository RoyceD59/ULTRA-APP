# Companion loading experience

## Visual direction
One glossy droplet and soft expanding ripples remain the focal point. An airy aqua background, compact Companion identifier, and stable Loading label establish a calm hierarchy. The layout adapts to narrow screens and system light/dark appearance. Avoid adding percentages or staged messages unless real progress data exists.

## Preview versus application
The HTML is a design preview and intentionally loops until paused. The pause button is a preview control, not an instruction to block the actual app. A static SVG is included. In the app, default to the static asset when reduced motion is requested; allow an explicit user choice to enable motion.

## Integration behavior
- Display only while a real operation is pending. Remove immediately on success or error; never add a minimum waiting time merely to finish the animation.
- For very quick requests, delay showing the loader about 200 ms to avoid a flash. Treat this as a proposed UX setting to validate in the app.
- Use the full composition only for initial loading or a screen without content. For refreshing an existing screen, preserve the content and use a small inline droplet near the affected section.
- Use a single polite status announcement. Keep the animated image decorative when the visible Loading text provides the accessible name.
- For a long wait, use an operation-specific explanation and an appropriate retry/cancel option once the actual request state supports it. Do not show endless Loading after failure.
- Keep authentication, navigation, payments, and request behavior unchanged when integrating this visual component.

## Validation status
Files updated; runtime browser rendering, responsive screenshots, and Companion app integration are not verified because local execution is unavailable in this session. The visual design is proposed, not a deployed change.
