# Ultra-Clear Companion — Store Listing Checklist

## App Identity
- **App Name:** Ultra-Clear Companion
- **Bundle ID (iOS):** com.ultraclean.companion
- **Package Name (Android):** com.ultraclean.companion
- **Version:** 1.0.0 (Build 1)
- **Category:** Shopping / Lifestyle

---

## iOS App Store (App Store Connect)

### Required Before Submission
- [ ] Apple Developer Account enrolled ($99/year)
- [ ] App Store Connect app record created
- [ ] Bundle ID `com.ultraclean.companion` registered in Apple Developer portal
- [ ] Push Notification certificate (if using push notifications)
- [ ] Privacy Policy URL published
- [ ] Terms of Service URL published

### App Store Listing Copy
**App Name:** Ultra-Clear Companion
**Subtitle:** Pure Water, Delivered Smart

**Description:**
The official companion app for Ultra-Clear water filtration systems. Manage your filters, shop replacement parts, book maintenance, and find the nearest water refill ATM — all in one place.

**Features:**
• Shop the full UCFilters catalogue with live pricing from ucfilters.com
• Pay securely with M-Pesa, credit/debit card (Stripe), or Paystack
• Track your filter's health and get timely replacement reminders
• Submit maintenance tickets with photos directly from your phone
• Book a free water quality test at your home or office
• Find experience centres and water refill ATMs across Nairobi on the map
• View order history and track deliveries

**Keywords:** water filter, reverse osmosis, purifier, M-Pesa, Nairobi, Kenya, clean water, UCFilters, filter replacement

**Support URL:** https://www.ucfilters.com/support
**Marketing URL:** https://www.ucfilters.com
**Privacy Policy URL:** https://www.ucfilters.com/privacy

### Screenshots Required
- [ ] iPhone 6.9" (iPhone 16 Pro Max) — 5 screenshots
- [ ] iPhone 6.5" (iPhone 14 Plus) — 5 screenshots
- [ ] iPad 13" (optional but recommended)

### Review Notes for Apple
- The app uses M-Pesa (Safaricom mobile money), Stripe, and Paystack for payments.
- All transactions are for physical water filtration products, not digital goods.
- Location permission is used to show nearby experience centres and water refill ATMs.
- Camera/photo library permission is used for attaching photos to maintenance tickets.

---

## Google Play Console

### Required Before Submission
- [ ] Google Play Developer Account ($25 one-time fee)
- [ ] App created in Play Console
- [ ] Data safety form completed (location, photos, payment data disclosed)
- [ ] Privacy Policy URL published
- [ ] Content rating questionnaire completed

### Store Listing Copy
**App Name:** Ultra-Clear Companion
**Short Description (80 chars):** Shop filters, book maintenance & find water ATMs near you.

**Full Description:** (same as iOS description above)

**Category:** Shopping
**Content Rating:** Everyone

### Graphics Required
- [ ] App icon: 512×512 PNG (no alpha, no rounded corners — Google adds them)
- [ ] Feature graphic: 1024×500 JPG or PNG
- [ ] Phone screenshots: 2-8 screenshots (16:9 or 9:16)
- [ ] Tablet screenshots (optional)

---

## OTA Updates (EAS Update)

OTA updates allow JS/content changes to ship to installed apps without a store re-review.

### Setup Steps
1. Run `npx eas update:configure` to link the project to your EAS account
2. Set the update URL in `app.json` under `expo.updates.url`
3. Deploy updates with `npx eas update --channel production --message "Fix: ..."`

### Channels
| Channel | Purpose |
|---|---|
| `production` | Live users — test before publishing |
| `preview` | Internal testing / QA |
| `development` | Local dev only |

### What CAN ship via OTA
- Bug fixes in JavaScript
- UI text and copy changes
- New screens that don't require native modules
- Feature flags and A/B tests

### What CANNOT ship via OTA (requires full build)
- Changes to native modules or plugins
- New permissions
- App icon or splash screen changes
- `app.json` changes

---

## Permissions Disclosure

| Permission | iOS Key | Android Permission | Reason |
|---|---|---|---|
| Location (approximate) | `NSLocationWhenInUseUsageDescription` | `ACCESS_COARSE_LOCATION` | Show nearest ATMs and experience centres |
| Location (precise) | — | `ACCESS_FINE_LOCATION` | Centre map on user's exact position |
| Camera | `NSCameraUsageDescription` | `CAMERA` | Attach photos to maintenance tickets |
| Photo Library | `NSPhotoLibraryUsageDescription` | `READ_MEDIA_IMAGES` | Attach photos from gallery to tickets |

---

## Compliance
- [ ] GDPR / Kenya Data Protection Act disclosure prepared
- [ ] Payment processor agreements signed (M-Pesa Daraja, Stripe, Paystack)
- [ ] WooCommerce store terms of sale updated to cover app purchases
