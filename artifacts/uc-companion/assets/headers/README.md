# Companion photographic headers

These assets are bundled locally; the app never contacts an image host to display them.

| Asset | Source / rights | Transformation |
| --- | --- | --- |
| `home-water.jpg` | Elle Hughes, [Pexels photo 2101147](https://www.pexels.com/photo/clear-drinking-glass-filled-with-water-2101147/) | 1200×600 centre crop, JPEG quality 78, metadata removed |
| `blog-water.jpg` | Same Elle Hughes photograph | 1200×600 centre crop, horizontally flipped, JPEG quality 76, metadata removed |
| `products-slide-shower.jpg` | User-supplied Ultra Clear poster `attached_assets/7_1791805350641.png` | Crop 1080×860 at y=290 (headline, contact bar, handles, QR, badges removed), sides padded by edge-pixel extension to 2:1, resized 1200×600, JPEG quality 80, metadata removed |
| `products-slide-household.jpg` | User-supplied poster `attached_assets/3_1791805350643.png` | Crop 1080×800 at y=300, edge-extended to 2:1, 1200×600, quality 80, metadata removed |
| `products-slide-bottles.jpg` | User-supplied poster `attached_assets/5_1791805350644.png` | Headline remnant between bottle tops (x 375-815, y 330-402) covered by stretching the plain background row at y=403; bottle tops untouched. Crop 1080×700 at y=330; 160 px side padding on both sides made by stretching the clean left-edge background column (x=0), so the right-edge strap is not smeared; 1200×600, quality 80, metadata removed |
| `shop-filter.jpg` (no longer used by Products) | User-supplied Ultra Clear product photograph `attached_assets/SGA08409_1784268217519.jpg` | 1200×500 canvas, cartridge at right, Deep Ocean padding, JPEG quality 82, metadata removed |

The [Pexels licence](https://www.pexels.com/license/) was checked on 2026-10-02:
free commercial use in websites/apps, modification allowed, attribution optional.
No endorsement by the photographer or a water brand is claimed. The stock water
photograph is illustrative hydration imagery, not evidence of product performance.
The cartridge uses the supplied brand photograph rather than a competing filter.

Sizes: Home 72,459 bytes; Blog 67,345 bytes; Shop 17,208 bytes; Products slides
shower 27,438, household 46,817, bottles 47,813 bytes.

The Products slides contain only the original product photography (brand marks
printed on products are part of the photograph); no product was added, altered
or distorted. Generated with ImageMagick from the originals, which stay in
`attached_assets/` and are not shipped. Order: shower, household, bottles. All below 200 KB.
The original full-resolution stock image is not shipped.

`../loading/water.gif` and `water-still.png` are original droplet/ripple artwork
created for this project by `scripts/create-water-loader.cjs` (ImageMagick).
GIF: 96×96, 16 frames, 1.28-second loop, 11,700 bytes; still: 1,408 bytes.
Both are below the 100 KB target. No external artwork or animation licence needed.