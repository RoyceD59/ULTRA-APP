# Deployment review: 19 October 2026

This is a read-only observation record. It does not approve a new publication.

| Check | Result | Evidence / limit |
| --- | --- | --- |
| PR #6 merged | PASS | Merged 08:02 UTC as `3731f8414e662b2dce464ba45f6a8481eeabfe23`. |
| Histories retained | PASS | Merge parent includes `6c64a852595d3898b460c4226f8b88ba355a65b6`, which retains old main and App. Merge and proposal share tree `b1f66f1ffbe28878435cbe8995c0659d3dd55622`. |
| Main post-merge CI | FAIL | Companion 683/752 passed, 69 failed; refill foundation failed two API assertions. Governance and Maps record health passed; EAS build/submission skipped. |
| Repair CI | PASS on `0160065`; inspect current PR head | [Companion](https://github.com/RoyceD59/ULTRA-APP/actions/runs/39229719093) 984/984, [foundation](https://github.com/RoyceD59/ULTRA-APP/actions/runs/39229584372) including 9 API tests/38 Hub test files/Node photo-order test, [governance](https://github.com/RoyceD59/ULTRA-APP/actions/runs/39229719219), and [isolated preview](https://github.com/RoyceD59/ULTRA-APP/actions/runs/39229719036) passed. Later follow-ups must be checked on [PR #7](https://github.com/RoyceD59/ULTRA-APP/pull/7), not inferred from these older runs. |
| Companion public metadata | PASS, identity only | At about 09:05 UTC, `app.ucfilters.com/version.json` serves build `1792278093274-833`, built `2026-10-17T23:04:38.593Z`, revision `consistency-41d38f627258152d7cc7132b275f7c495e44e1ca1503391a165efed316e5212a`. Production marker true, API origin `https://api.ucfilters.com`, web/Expo Go IDs agree. |
| Replit Companion metadata | PASS, identity only | `/uc-companion/version.json` serves the same build/revision. The Replit root `/version.json` returned 200 **HTML**, so that URL cannot be used as version evidence. |
| Native manifests on both hosts | PASS, manifest identity only | Corresponding platform IDs agree: iOS `4c2a451a-7877-4462-b0e3-388d5b9c5c9d`, Android `50acc2d6-0c4a-45dc-ae76-7a23c075d33c`. Both launch keys are `bundle-1792278093274-833`, and launch URLs point to the corresponding platform bundle under the public app's versioned `/uc-companion/` path. This is not a phone-launch or standalone-binary pass. |
| API health on both hosts | PASS, health endpoint only | `api.ucfilters.com/api/healthz` and the registered Replit origin return 200 JSON with `status: ok`. |
| Public global snapshots | PASS, observed interval only | At 09:05:17–09:05:22 UTC, both `/api/uc/impact` responses have snapshot `9ef3b54c4cfe12d9216b71e300d3c5981de6534fff7c662e29aa7efc1a599c2b`, adjustment revision 1, max age 60 seconds and agreeing values: 6 users, 1550 litres, 3100 plastics, 0 clean-water days. These are API-reported figures, not an independent audit of their inputs or formula. |
| Hub HTTP availability | PASS, HTTP only | `hub.ucfilters.com/` returns 200 HTML. Asset/source parity, auth and dashboard behaviour are still unverified. |
| Published API/Hub source lineage | UNVERIFIED | Health/HTML availability does not expose enough evidence to prove the exact selected API/Hub archive. Obtain main publishing/build evidence. |
| Live asset hashes and complete rollback | PASS locally; publication integration UNVERIFIED | The existing guarded capture retained 62 files and verified all 60 referenced asset URLs, rechecking the live build before/after. Bounded transport retries resolved connection resets without changing its validation rules. The three bundle hashes below also match the registered Replit host. The captured tree is retained in the task workspace, not installed into the main Replit publication selection. |
| Admin/two-customer snapshot and isolation checks | UNVERIFIED | Requires the approved existing-account secure-access flow. No customer identifiers or credentials are recorded here. |
| Physical iPhone/Android checks | UNVERIFIED | Remain under task #822. |

Verified public bundle bytes (downloaded, never executed by the capture):

| Platform | Bytes | SHA-256, equal on app and registered Replit hosts |
| --- | ---: | --- |
| Web | 4,905,452 | `7790bc65fa037d79a578f5fef594febfd4e84856fc61ffb3483fa907faba85e1` |
| iOS | 6,639,128 | `c28c7cf48a5d153e6249e0a6912a17da3ccb4812335c7cfe948dad487be4ce0d` |
| Android | 6,811,452 | `96dfe283075b889a1d2c466b5ce7be41acef10a903c5d8e47d9b0954d7f34169` |

The live Companion build time predates PR #6. The merge closed the repository
history gap; these observations do not show a new client publication caused by
that merge. Source repairs remain on the CI repair branch until reviewed and
separately selected for release.

Next action: complete the repair checks and the rollback/served-asset evidence,
then follow [the deployment validity guide](deployment-validity-guide.md).
