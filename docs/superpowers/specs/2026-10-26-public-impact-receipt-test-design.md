# Isolated Actions-bot notification receipt test

The owner approved preparation of a manual-only Actions-bot test after a
self-authored CLI comment failed to establish receipt.

- Separate workflow; no schedule, production probes, database, application
  credentials, production checker execution, or edits to the live state issue.
  Reuse only the existing bounded JSON parser for provider responses.
- Hardcoded repository `RoyceD59/ULTRA-APP`, test issue 12, and expected title.
  No user-supplied target or comment text.
- Preview is the default and performs no network calls. Sending requires
  `dry_run=false` and the exact confirmation `SEND TEST TO ISSUE 12`, in
  the named workflow on `main`, first attempt only.
- Before sending, validate the isolated issue and persist a permanent one-shot
  claim in its body. Serialize runs. An ambiguous claim prevents sending; a
  stored claim prevents all future automatic sends, even after a crash.
- Send exactly one clearly labeled TEST comment with the Actions built-in token.
  Never retry provider writes. An ambiguous response is recorded as uncertain.
- Save only sanitized UTC status, test identifier, and allowlisted comment URL.
  GitHub acceptance is not receipt. The owner separately confirms the identifier
  and channel; no private addresses or headers are needed.
- Test all guards and failure paths with injected requests. No live send during
  development. Review/merge and separate send approval remain required.

The test cannot resolve the runner's HTTP 403 or authorize monitor activation.
