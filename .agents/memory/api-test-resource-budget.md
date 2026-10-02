---
name: API test resource budgets
description: Why API tests need bounded worker and transform-process thread counts in this container.
---

Bound both test-file parallelism and code-transform process threads; do not derive safe concurrency from the host's advertised CPU count.

**Why:** Each TypeScript test worker starts an esbuild process. A large worker pool combined with the host's CPU count exhausted the container's OS-thread budget before assertions ran, producing misleading widespread failures and long-running validation.

**How to apply:** Keep conservative default test concurrency and Go transform-thread limits, with explicit bounded overrides for larger environments. If failures mention new OS threads or a stopped transform service, inspect process resources before changing application assertions.