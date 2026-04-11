# Automation Runner Sandbox Evaluation

## Bottom line

The automation runner does not need to be sandboxed in the abstract.

For **Keppo as currently designed**, the automation runner should be treated as **sandbox-required by default**, with the trusted control plane staying outside the sandbox and the actual model/tool loop running inside a per-run isolated environment.

That is already the architecture this repo uses today:

- the Start-owned runtime prepares the run, refreshes credentials, issues run-scoped MCP auth, and signs callbacks
- the runner itself executes inside a sandbox provider selected by `KEPPO_SANDBOX_PROVIDER`
- the sandbox streams logs and terminal state back through signed callback routes

In other words: **hybrid is the right shape here**. The control plane should stay trusted and server-side; the agent execution loop should stay isolated.

## Why sandboxing matters in this repo

Sandboxing is not just an implementation detail in Keppo. It is tied directly to the runtime and security contract:

- Automation runs are explicitly dispatched through a sandbox provider in [`apps/web/app/lib/server/automation-runtime.ts`](apps/web/app/lib/server/automation-runtime.ts) and described as such in [`docs/specs/execution-workers-connectors.md`](docs/specs/execution-workers-connectors.md).
- The security model says automation runs execute in isolated sandbox providers, with `mcp_only` as the default network posture and `mcp_and_web` as explicit opt-in in [`docs/specs/security-model.md`](docs/specs/security-model.md).
- The security rules require sandboxes to receive minimal env and network access, and they explicitly forbid production use of the Docker provider in [`docs/rules/security.md`](docs/rules/security.md).
- The env/runtime rules require an explicit runner package contract and minimal sandbox `PATH`, not ad hoc host execution in [`docs/rules/env_runtime.md`](docs/rules/env_runtime.md).

The current runtime also relies on sandbox-specific controls that become much weaker or disappear if the runner executes directly on the host:

- run-scoped MCP bearer tokens
- signed log / trace / complete callbacks
- bootstrap vs runtime secret separation
- per-run timeout and termination
- network mode selection via `mcp_only` vs `mcp_and_web`

Without a sandbox, several of those controls turn from hard boundaries into conventions.

## Evaluation criteria

For Keppo, the main decision criteria are:

1. **Blast radius**: what happens if the runner, model SDK, or a tool path misbehaves?
2. **Secret containment**: can model keys, MCP bearer tokens, and callback secrets be narrowly scoped and short-lived?
3. **Network control**: can `mcp_only` be enforced as a real egress boundary?
4. **Tenant isolation**: can one run be kept from affecting another run or the host runtime?
5. **Operational clarity**: can the system time out, terminate, and observe runs deterministically?
6. **Cost and latency**: what are the cold-start and bootstrap costs?
7. **Portability**: can local, test, and remote environments share the same runner contract?

## Architecture options

### 1. No sandbox: run the automation loop in the API process

**Pros**

- simplest implementation
- lowest startup latency
- easiest local debugging
- no callback bridge or sandbox orchestration layer

**Cons**

- worst blast radius; a runner bug becomes an app-runtime incident
- `mcp_only` becomes mostly advisory because the host process already has broad network reach
- model keys and MCP credentials live in the same process boundary as the app server
- timeout and cancellation become less trustworthy under heavy load
- weak multi-tenant isolation
- diverges from the repo's current security and execution specs

**Fit for Keppo**

Bad fit for hosted Keppo. Acceptable only for narrow local-debug or single-tenant trusted-operator scenarios, and even then only as an explicit opt-in path.

### 2. Host subprocess with no real sandbox

This means spawning `node runner.mjs` or similar on the host, but outside the main web process.

**Pros**

- cheaper and simpler than full sandboxing
- slightly better crash containment than in-process execution
- easy to prototype

**Cons**

- still shares the host filesystem, host network, host env surface, and host trust domain
- does not meaningfully enforce `mcp_only`
- still weak for tenant isolation and credential containment
- tends to accumulate ad hoc hardening until it recreates a sandbox poorly

**Fit for Keppo**

Better than in-process, but still not strong enough for the current product/security model. This is a transitional architecture at best, not an end state.

### 3. Hybrid control plane + per-run sandboxed runner

This is the current Keppo architecture.

The trusted API runtime does the high-trust work:

- claim validation
- key lookup and refresh
- run-scoped credential issuance
- MCP preflight
- signed callback creation
- run state transitions

The sandboxed runner does the low-trust execution work:

- connect to the MCP server
- run the Agents SDK loop
- emit structured logs
- export trace metadata
- terminate on timeout or cancellation

**Pros**

- strongest fit for Keppo's current threat model
- lets the control plane keep broad secrets out of the sandbox
- supports real per-run isolation
- makes `mcp_only` enforceable when the provider supports egress policy
- preserves deterministic run lifecycle through callbacks and run ids
- maps well to the existing repo-owned runner contract in [`apps/web/app/lib/server/api-runtime/sandbox/agents-sdk-runner.ts`](apps/web/app/lib/server/api-runtime/sandbox/agents-sdk-runner.ts)

**Cons**

- more moving parts
- cold starts and package bootstrap cost
- callback reachability becomes part of correctness
- local development requires sandbox infrastructure
- debugging is more distributed

**Fit for Keppo**

Best option. This should remain the default architecture.

### 4. Long-lived worker pool with shared hosts

This means a dedicated automation-worker service or pool, possibly with reused workers across runs.

**Pros**

- can amortize startup cost
- may improve throughput for high run volume
- can centralize automation-specific observability

**Cons**

- easy to introduce cross-run contamination
- longer-lived worker state increases secret residency risk
- isolation depends on whether each run still gets its own container or VM
- much higher operational complexity
- can drift away from the repo's current clean per-run contract

**Fit for Keppo**

Potentially viable only if each run still gets strong per-run isolation. A shared long-lived worker without per-run sandboxing is not a good replacement for the current model.

### 5. Provider-hosted or vendor-managed agent execution

This means letting an external AI platform own more of the run lifecycle.

**Pros**

- lowest infra burden for Keppo
- potentially strong model-native tracing and orchestration

**Cons**

- weaker control over tool routing and network policy
- harder to enforce Keppo-specific contracts like `record_outcome`, `add_memory`, and run-scoped MCP auth
- larger vendor lock-in
- less control over credential exposure and redaction
- harder to keep the runner behavior portable across local, test, and production

**Fit for Keppo**

Poor fit unless Keppo intentionally gives up a lot of runtime control. That would be a product and security model change, not just an implementation swap.

## Sandbox provider options in this repo

If the answer is "yes, sandbox it", there is a second question: **which sandbox?**

### Docker

Current role: local dev / test only.

**Pros**

- easiest local parity
- straightforward to inspect and debug
- aligns well with the repo-owned runner image in [`apps/web/app/lib/server/api-runtime/sandbox/Dockerfile`](apps/web/app/lib/server/api-runtime/sandbox/Dockerfile)

**Cons**

- not allowed in production by repo policy and code
- coarser isolation than a true remote VM or MicroVM
- depends on host Docker availability

**Recommendation**

Keep using for local development, E2E, and explicit sandbox verification. Do not use for hosted production.

### Vercel Sandbox

Current role: strongest managed remote sandbox path.

**Pros**

- clear bootstrap/runtime separation
- bootstrap can stay package-registry-only and secret-free
- runtime can enforce host allowlists for `mcp_only`
- detached command lifecycle and termination are already implemented in [`cloud/api/sandbox/vercel.ts`](cloud/api/sandbox/vercel.ts)

**Cons**

- callback base URL must be publicly reachable
- higher orchestration complexity
- package install during bootstrap adds startup cost
- introduces provider dependence on Vercel sandbox behavior

**Recommendation**

Best fit when strict egress control matters most. If Keppo wants the strongest current enforcement of `mcp_only`, this is the cleanest production option in the repo today.

### Unikraft

Current role: remote MicroVM option.

**Pros**

- strong compute isolation model
- explicit instance lifecycle
- clean fit for per-run execution

**Cons**

- current repo contract does **not** enforce instance-level egress policy for `mcp_only`
- log streaming is poll-based, which is operationally noisier
- requires image and platform management

**Recommendation**

Reasonable when MicroVM isolation or platform preference matters, but weaker than Vercel today if strict outbound policy enforcement is a requirement. If Keppo wants Unikraft as the primary production path, it should close the egress-policy gap first.

## Recommendation

### Decision

For Keppo, the automation runner should **continue to execute in a sandbox**.

### Preferred model

Keep the current split:

- **outside the sandbox**: dispatch auth, key refresh/decryption, run-scoped credential minting, MCP preflight, callback signing, billing sync, state transitions
- **inside the sandbox**: the Agents SDK runner, MCP session activity, model/tool loop, structured log emission, trace export, timeout-bound execution

### Production guidance

- Prefer **Vercel Sandbox** when real `mcp_only` egress enforcement is required.
- Use **Unikraft** only if its operational or isolation tradeoffs are preferred and its weaker current network-policy story is acceptable or fixed.
- Keep **Docker** local-only.

### What I would not ship

- a default host-process runner for hosted automations
- a host-subprocess runner presented as if it were equivalent to sandbox isolation
- any design that pushes broad management secrets into the runner boundary
- any design where `mcp_only` stops being a hard policy and becomes a best-effort convention

## When a non-sandbox path is acceptable

A non-sandbox runner can be acceptable if all of the following are true:

- the deployment is single-tenant or operator-trusted
- the automation author is effectively trusted
- the host runtime has no sensitive cross-tenant surface to protect
- `mcp_only` is not being sold as a real security boundary
- the operator explicitly accepts a larger blast radius

That is not the default Keppo product posture.

## Non-negotiables if this design changes later

If Keppo ever revisits this decision, these properties should remain:

- keep bootstrap env separate from runtime secrets
- keep run-scoped MCP credentials and revoke them on terminal state
- keep signed callbacks for log, trace, and completion
- keep explicit timeout and termination behavior
- keep `mcp_only` as a real, enforceable boundary, not just prompt text
- keep broad control-plane secrets such as gateway management credentials out of the runner

## References

- [`apps/web/app/lib/server/automation-runtime.ts`](apps/web/app/lib/server/automation-runtime.ts)
- [`apps/web/app/lib/server/api-runtime/sandbox/index.ts`](apps/web/app/lib/server/api-runtime/sandbox/index.ts)
- [`apps/web/app/lib/server/api-runtime/sandbox/agents-sdk-runner.ts`](apps/web/app/lib/server/api-runtime/sandbox/agents-sdk-runner.ts)
- [`apps/web/app/lib/server/api-runtime/sandbox/Dockerfile`](apps/web/app/lib/server/api-runtime/sandbox/Dockerfile)
- [`cloud/api/sandbox/vercel.ts`](cloud/api/sandbox/vercel.ts)
- [`apps/web/app/lib/server/api-runtime/sandbox/unikraft.ts`](apps/web/app/lib/server/api-runtime/sandbox/unikraft.ts)
- [`docs/specs/execution-workers-connectors.md`](docs/specs/execution-workers-connectors.md)
- [`docs/specs/security-model.md`](docs/specs/security-model.md)
- [`docs/rules/security.md`](docs/rules/security.md)
- [`docs/rules/env_runtime.md`](docs/rules/env_runtime.md)
