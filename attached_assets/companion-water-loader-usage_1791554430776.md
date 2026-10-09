# Glossy Companion loader

The standalone SVG has a transparent background, a 24 × 24 viewBox, embedded CSS, and a 1.4-second loop. One glossy droplet falls at a time; two expanding ripples appear at impact and fade while the next drop falls. This explicitly requested continuous-motion version plays even with reduced-motion preferences enabled. Before app integration, provide a static alternative for users who prefer reduced motion. No JavaScript or external assets are required.

Vanilla HTML or Vue template (put the SVG in your public assets folder):

```html
<img src="/companion-water-loader.svg" width="32" height="32" alt="Loading">
```

React:

```jsx
{isLoading && <img src="/companion-water-loader.svg" width={32} height={32} alt="Loading" />}
```

Vue conditional: add `v-if="isLoading"` to the image element.

For inline SVG, paste the file contents into the HTML/template. For a React inline component, convert `class` to `className`, hyphenated attributes to camelCase, and place CSS inside a style string. Give the gradient a unique ID per instance and update its fill reference (React useId is suitable).

Glossy blue gradients are intentional; this version does not use monochrome currentColor. Show the loader only while the actual operation is pending and remove it on success or error. Browser rendering and app integration have not yet been verified.
