---
name: UC Companion release versioning
description: Alpha / Beta / v1.0 release ladder agreed with user — which tasks belong to which milestone
---

# UC Companion release versioning

## Decision
User confirmed that "out of scope" items deferred in task plans are required for the final release. The project uses three milestones: Alpha → Beta → v1.0.

**Why:** Prevents scope bleed into early tasks while keeping all deferred items tracked for future delivery. Every deferred item is now either an existing task or a proposed task.

## Alpha (current)
Core app functional with mock/in-memory fallbacks where live credentials are absent.
- 28 real products ✅
- Filter tracker + performance check-in ✅
- Push notifications DB-backed ✅ (Task #8)
- Map, tickets, water test, referral ✅
- Task #11 — Fix stale content + enquiry-only card UI
- Task #12 — Database persistence (users, tokens, orders, tickets)
- Task #13 — AI water quality assistant

## Beta (before App Store submission)
All core flows work with real data; no mock fallbacks for production.
- Task #3  — Live WooCommerce + M-Pesa / Stripe / Paystack
- Task #9  — Notification preferences screen
- Task #14 — Push token refresh on app foreground
- Task #15 — Enquiry flow for enquiry-only products
- Task #16 — Profile view + edit (name, phone)
- Task #17 — SMS + email confirmations (Africa's Talking + SMTP)
- Task #18 — Real guide content (installation, care, FAQ)
- Task #6  — App Store / Play Store build (contacts, video, maps permissions)
- Task #7  — Android Maps API key for production build

## v1.0 / Final Release
Features deferred from task "out of scope" sections and any remaining audit gaps.

| Feature | Origin |
|---|---|
| Admin dashboard (order/ticket/enquiry management) | Task #12 out-of-scope |
| In-app payment receipts / transaction ledger | Task #12 out-of-scope |
| AI conversation history persisted across sessions | Task #13 out-of-scope |
| Voice input / speech-to-text in AI chat | Task #13 out-of-scope |
| Image analysis of water samples | Task #13 out-of-scope |
| Human handoff to live support agent from AI chat | Task #13 out-of-scope |
| Real product photography (replacing placehold.co) | Audit gap |
| Swahili language localisation | Future |
| WhatsApp Business API integration | Task #17 out-of-scope |
| CMS-backed guide articles (editable without app update) | Task #18 out-of-scope |
| PDF download / share for guides | Task #18 out-of-scope |
| Address book / saved delivery addresses | Task #16 out-of-scope |
| Password change flow (OTP verified) | Task #16 out-of-scope |
| OTP / 2FA via SMS at login | Task #17 out-of-scope |
| Marketing SMS campaigns | Task #17 out-of-scope |
| CRM integration (Zoho / HubSpot) for enquiries | Task #15 out-of-scope |

**How to apply:** When new tasks are created, assign them to one of these three milestones. Do not add v1.0 items to Alpha or Beta unless the user explicitly reprioritises.
