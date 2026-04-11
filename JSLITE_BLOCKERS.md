# JSLite Production Blockers

`KEPPO_CODE_MODE_SANDBOX_PROVIDER=jslite` is intentionally blocked outside local/dev and e2e-style runtimes.

These issues are still critical enough to prevent production use:

1. The current Keppo integration runs JSLite as a host-side sidecar process, not inside a container or microVM. That is stronger than the in-process addon, but it still does not provide the network, filesystem, and OS-level isolation Keppo expects from production Code Mode sandboxes.
2. Keppo does not ship a pinned JSLite artifact today. The provider currently resolves either an adjacent `../jslite` checkout or an explicit `KEPPO_JSLITE_SIDECAR_PATH`, which is workable for local development but not a reproducible hosted deployment contract.
3. JSLite executes a narrower JavaScript subset than Keppo’s existing Code Mode contract. This integration swaps in a JSLite-specific SDK wrapper, but common modern JavaScript patterns still fail validation, so treating it as a transparent drop-in production sandbox would change product behavior.

Until those blockers are closed, use `vercel` or `unikraft` for non-local Code Mode deployments.
