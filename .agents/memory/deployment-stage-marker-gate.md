---
name: Deployment stage marker gate
description: How the post-build image cleanup treats approved, scratch and invalid build folders, and what still fails the publish.
---
Post-build cleanup classifies each folder under `.consistency-build/` and `.hydrate-release`. Approved stages (64-hex name with a `.prepared` marker equal to the name, plus the legacy `.hydrate-release` stage) are strictly checked. Any other folder, including an unmarked 64-hex one, is scratch and only has its installed `node_modules` stripped (root, `artifacts/*`, `lib/*`). A marker that exists but is wrong, a legacy stage without a marker, and any symlinked folder or workspace package still fail the publish before anything is removed.

**Why:** two publishes failed after every build passed: an unmarked hash-named folder aborted cleanup, then about 9 GiB of installed dependencies in scratch folders made the image layer push fail with a closed-pipe error.

**How to apply:** scratch trial extractions are now safe to leave in place, but a hash-named folder should never carry a marker that is not its own name. The build prints a per-folder status/size summary and warns above 7 GiB (override with `DEPLOYMENT_IMAGE_WARN_BYTES`); treat that warning as a reason to remove large inputs before publishing. The summary walk takes about a minute on a full workspace.
