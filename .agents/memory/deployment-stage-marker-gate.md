---
name: Deployment stage marker gate
description: Post-build image cleanup fails the whole publish if any 64-hex stage under .consistency-build lacks a valid .prepared marker.
---
Any directory in `.consistency-build/` whose name is a 64-hex checksum must contain a matching `.prepared` marker, or the post-build cleanup aborts the publish after all builds succeed.

**Why:** an interrupted or abandoned trial extraction left two unmarked checksum-named stages and a publish failed at the very last step ("Missing ordinary preparation marker").

**How to apply:** name scratch or trial extractions with a non-checksum name (e.g. `abandoned-...`, `*-draft`), or rename them rather than deleting. Before suggesting a publish, confirm every 64-hex stage has a marker equal to its own name.

Scratch stages are not covered by the post-build dependency cleanup (it only handles `.hydrate-release` and 64-hex stages), so their installed `node_modules` ship in the image.

**Why:** three trial extractions plus one abandoned stage held about 9 GiB of installed dependencies; the image layer push then failed with a closed-pipe error after the build and cleanup had succeeded.

**How to apply:** after any trial or cold-install extraction under `.consistency-build/`, remove its `node_modules` (root, `artifacts/*`, `lib/*`) before suggesting a publish. Sources can stay; installs are regenerable from the sealed archive.
