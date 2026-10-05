---
name: Frozen release verification
description: Verify narrow production fixes reach the live app without publishing unrelated working-tree changes.
---

Treat a successful publish as confirmation that the selected package built and started, not proof that the newest working-tree fix was included.

**Why:** publishing succeeded while the WhatsApp recovery controls remained old because the production build used a frozen source package. Repeated publishing alone could not include the approved fix.

**How to apply:** inspect the actual live feature or bundle before doing operational recovery. If production is intentionally frozen, add only the explicitly approved fix to the package, verify unrelated archived files are unchanged, and test the packaged implementation. Do not bypass the frozen release by switching to whole-working-tree builds.

Background-task changes must be applied to the main project before asking the user to publish them.

**Why:** a user successfully republished, but the build still produced the old bundle because the tested packaging correction existed only in the task's isolated copy. Publishing success did not mean that task's changes were deployed.

**How to apply:** separate code/package preparation from post-apply production operations when a task requires both. Agree on that scope with the user rather than repeatedly asking them to republish changes not yet applied. Consult the task-system documentation if unsure which project copy publishing uses.

Compile the frozen candidate itself, including its dependent contracts; a working-tree typecheck is not enough.

**Why:** A frozen package can retain older dependent contracts even when the working tree compiles and the changed files fit the intended allowlist.

**How to apply:** Prepare an additive candidate without selecting it, typecheck its consumer apps, and verify its actually selected manifest/launch bytes separately from signed-in working-preview behavior.

A healthy preview endpoint does not establish that the current source is running.

**Why:** An older API process continued answering HTTP 200 while its managed workflow failed with a port conflict. New clients rejected its older response contract despite successful current-source compilation and isolated API tests.

**How to apply:** Verify process ownership/start time and the actual response contract separately from workflow status and health checks. In a read-only verification request, report the mismatch rather than silently replacing the process.