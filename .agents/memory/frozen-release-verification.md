---
name: Frozen release verification
description: Verify narrow production fixes reach the live app without publishing unrelated working-tree changes.
---

Do not replace an entire shared API hook just to include a product/checkout
method in a frozen release. Reconcile its contracts with the frozen generated
client and every retained consumer, or preserve unrelated methods.

**Why:** A product-page source splice imported unrelated generated customer/
hydration models and changed the QR/session caller signatures. The editable
tree's successful checks did not establish that the hybrid archive compiled.

**How to apply:** Validate the exact hybrid source after each coherent assembly.
Inspect shared-hook and import/export changes as compatibility boundaries; keep
an incompatible review archive unselected instead of treating source copying as
release completion.

Treat a successful publish as confirmation that the selected package built and started, not proof that the newest working-tree fix was included.

Repeat dependency risk checks against the exact frozen archive before a later
publication; earlier approval and passing fixtures are not a permanent
security pass.

**Why:** A previously approved archive remained selected while newer dependency
fixes existed only in an unselected consolidated candidate. A fresh audit
exposed an unpatched critical finding despite earlier preparation evidence.

**How to apply:** Audit the selected lockfile and validate documented backports
separately from unpatched findings. Do not substitute working-tree or
consolidated-package results, and do not bypass a critical/high release blocker
just because live snapshot compatibility passes.

Check lockfile semantics, not just the names/count of changed files, when
preparing a dependency-only revision from frozen source.

**Why:** Regenerating a frozen lock pruned an importer absent from the source
archive and changed unrelated codegen peer contexts. A three-file allowlist
alone did not prevent that incidental scope expansion.

**How to apply:** Preserve unrelated importer versions and complete peer-context
dependency graphs, verify their semantics against the parent, and require a
successful frozen-lockfile installation before sealing validation evidence.

Do not blindly add a prepared marker to a populated verification stage.

**Why:** A valid review stage lacked the handoff marker; its existing compilation
outputs did not prove its retained source bytes still matched the selection.

**How to apply:** Before adopting a pre-existing stage, compare every retained
source file and mode with the pinned archive and verify its installed dependency
graph. Preserve retained outputs and record that verification rather than
deleting the stage or bypassing the nonempty-stage guard.

Production-only dependency audits do not cover every dependency baked into
runtime build outputs.

**Why:** A logging dependency classified as development-only was reported by the
broader scan but omitted from the production-only package-manager audit.

**How to apply:** Compare broader scanner results and actual compiled workers;
do not dismiss a finding solely because the manifest labels it dev-only.

A standby-based publication can omit compilation/source-archive evidence from
its logs. The referenced standby build may not be retrievable through the
published-build details callback.

**Why:** A successful promotion identified a standby build but its source details
were unavailable; current main selection and fresh public snapshots could not
establish the exact live authentication/upload revision.

**How to apply:** Trace the promoted source build or obtain safe served-source/
feature evidence. If unavailable, record exact live source as unverified; never
substitute the current selector or unrelated client version metadata as proof.

**Why:** publishing succeeded while the WhatsApp recovery controls remained old because the production build used a frozen source package. Repeated publishing alone could not include the approved fix.

**How to apply:** inspect the actual live feature or bundle before doing operational recovery. If production is intentionally frozen, add only the explicitly approved fix to the package, verify unrelated archived files are unchanged, and test the packaged implementation. Do not bypass the frozen release by switching to whole-working-tree builds.

Background-task changes must be applied to the main project before asking the user to publish them.

**Why:** a user successfully republished, but the build still produced the old bundle because the tested packaging correction existed only in the task's isolated copy. Publishing success did not mean that task's changes were deployed.

**How to apply:** separate code/package preparation from post-apply production operations when a task requires both. Agree on that scope with the user rather than repeatedly asking them to republish changes not yet applied. Consult the task-system documentation if unsure which project copy publishing uses.

Compile the frozen candidate itself, including its dependent contracts; a working-tree typecheck is not enough.

**Why:** A frozen package can retain older dependent contracts even when the working tree compiles and the changed files fit the intended allowlist.

**How to apply:** Prepare an additive candidate without selecting it, typecheck its consumer apps, and verify its actually selected manifest/launch bytes separately from signed-in working-preview behavior.

A frozen source package does not by itself limit the production schema changes
included in publication. An empty current schema diff also cannot establish
that a prior publication respected the narrow approved scope.

**Why:** A successful frozen API publication included unrelated additive schema
changes; the next development-to-production diff was empty because those
changes were already present.

**How to apply:** Review the full schema diff before publication and the
matching publication's migration logs afterward. Keep source approval,
schema approval and client advancement separate; stop advancement when the
prior publication includes unreviewed changes outside the approved scope.

Owner approval of a retained source revision's byte scope and main build
selection is not approval to publish it or advance clients.

**Why:** The owner chose security-only candidate selection while publication,
production initialization and client advancement were explicitly excluded.

**How to apply:** Keep source-selection evidence distinct from live deployment
evidence. Ask separately before publishing; keep any API compatibility and
fresh-public-snapshot client gates in force.

A healthy preview endpoint does not establish that the current source is running.

**Why:** An older API process continued answering HTTP 200 while its managed workflow failed with a port conflict. New clients rejected its older response contract despite successful current-source compilation and isolated API tests.

**How to apply:** Verify process ownership/start time and the actual response contract separately from workflow status and health checks. In a read-only verification request, report the mismatch rather than silently replacing the process.

Verify referenced public font/image URLs separately from manifests, bundle delivery and compilation.

**Why:** Valid served metadata and all three downloadable bundles coexisted with HTTP 404 font dependencies and missing icons. An older local asset directory was not evidence of the current public deployment.

**How to apply:** Record actual dependency availability. Recovery bytes need hash evidence from the served bundle; matching a declared platform/scale hash does not certify visual parity or repair the public route.