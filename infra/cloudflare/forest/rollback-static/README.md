# Retained public consistency predecessor

These are release inputs for build `1791182522315-296`, not a newly selected
release. `capture-evidence.json` identifies every unique retained file and hash.

Version metadata, web/iOS/Android bundles and native manifests were downloaded
from the actually served release. Some asset URLs declared by those bundles
return HTTP 404. Dependency bytes recovered from older retained local output are
accepted only when their MD5 appears in the platform/scale `fileHashes` declared
by the served native bundles. No older metadata or JavaScript bundles replace
the live ones.

The retention helper verifies local completeness; this does not prove existing
public asset URLs work or certify platform/scale visual parity. Do not claim
that rollback preparation repaired the production icon failures.

The API-first publication retains old client source selection and may compile a
new predecessor build ID. Recapture and verify the actually served predecessor
before publishing candidate clients; do not silently reuse this directory for a
different served ID.

Keep this directory in publication input. Never delete retained assets during
activation or rollback, and never revert the shared impact database to file
authority.
