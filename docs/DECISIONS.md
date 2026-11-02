# Architecture & Engineering Decision Records (ADR)

This document records architectural, engineering, and design decisions made throughout the development of CiteWriter, documenting what was chosen, why, and what alternatives were considered.

---

## ADR 002: Zod Schemas and LangGraph State Channels (Phase 1)

- **Date:** 2026-11-03
- **Status:** Accepted

### Context

CiteWriter's shared state must pass between four distinct agent roles, persist durably via checkpointers, and expose consistent typed contracts. We needed to choose how state contracts and runtime schemas are unified between Zod and LangGraph.js v1.6.

### Decision

1. Define primary domain entities (`Note`, `Claim`, `ClaimCheck`, `EditorVerdict`, `RunConfig`, `HumanAction`) with Zod schemas to ensure parse-time validation on all agent inputs and outputs.
2. Mirror these schemas in LangGraph's `Annotation.Root` channels with explicit reducer functions.
3. Keep `packages/core` completely independent of runtime web/API dependencies.

### Alternatives Considered

- _TypeScript interfaces without Zod runtime validation:_ Rejected because LLM outputs are inherently probabilistic and untrusted; strict Zod runtime parsing is required by the project specification.

---

## ADR 003: Deterministic Routing, Caps, and Review Interrupt (Phase 1)

- **Date:** 2026-11-03
- **Status:** Accepted

### Context

The system specifies two conditional routing junctions (Route A after Fact-checker, Route B after Editor) with bounded loops (max 2 research rounds, max 3 write cycles), open flag tracking, and human review interrupts.

### Decision

1. Implement pure deterministic routing functions (`routeAfterFactChecker`, `routeAfterEditor`) without an LLM supervisor.
2. Introduce a dedicated `prepareReview` node preceding `humanReview`. When caps are hit with unresolved flags (or when the editor accepts), `prepareReview` sets `status: 'awaiting_review'` and populates `openIssues` before the checkpoint is committed.
3. Use LangGraph's native `interrupt()` inside `humanReviewNode`. When resumed via `Command({ resume: HumanAction })`, the node resumes cleanly, records the human action, applies manual edits if provided, and transitions to `END`.
4. Enforce mathematical termination: because `researchRounds` and `writeCycles` strictly increment on each loop and routing checks enforce `< 2` and `< 3`, infinite loops are provably impossible.

### Alternatives Considered

- _LLM Supervisor for routing:_ Rejected per project brief specification; with 4 agents, a supervisor adds latency, monetary cost, and unnecessary failure modes.
- _Handling state mutation inside conditional edge:_ Rejected because LangGraph conditional edges are pure routing resolvers; node execution ensures state updates are properly saved to checkpoints.

---

## ADR 001: Monorepo Structure and Tooling (Phase 0)

- **Date:** 2026-11-02
- **Status:** Accepted

### Context

CiteWriter consists of a full-stack system with a decoupled multi-agent core library (`packages/core`), an evals package (`packages/evals`), a Fastify backend with BullMQ workers (`apps/api`), and a Next.js App Router frontend (`apps/web`). We need a workspace setup that enforces TypeScript strict mode, clean boundaries, fast local execution, and independent verification of the core graph.

### Decision

1. Use **pnpm workspaces** with root-level orchestration (`pnpm -r`).
2. Centralize shared TypeScript configurations in `tsconfig.base.json` with strict mode enabled across all packages and apps (`strict: true`, `noImplicitAny: true`, `noUncheckedIndexedAccess: true`).
3. Use **Vitest** across the monorepo for fast, unified unit and integration testing.
4. Use **ESLint** (flat config) and **Prettier** for monorepo-wide code quality and formatting.
5. Isolate `packages/core` from database and HTTP transport dependencies so it can execute in isolation from plain Node scripts and unit tests.

### Alternatives Considered

- _npm/yarn workspaces:_ pnpm was chosen for strict dependency resolution (preventing phantom dependencies) and fast symlink-based node_modules caching.
- _Single monolith package:_ Rejected because `packages/core` must be evaluated and tested independently without booting web servers or database connections.

---

## ADR 002: Zod Schemas and LangGraph State Channels (Phase 1)

- **Date:** 2026-11-03
- **Status:** Accepted

### Context

CiteWriter's shared state must pass between four distinct agent roles, persist durably via checkpointers, and expose consistent typed contracts. We needed to choose how state contracts and runtime schemas are unified between Zod and LangGraph.js v1.6.

### Decision

1. Define primary domain entities (`Note`, `Claim`, `ClaimCheck`, `EditorVerdict`, `RunConfig`, `HumanAction`) with Zod schemas to ensure parse-time validation on all agent inputs and outputs.
2. Mirror these schemas in LangGraph's `Annotation.Root` channels with explicit reducer functions.
3. Keep `packages/core` completely independent of runtime web/API dependencies.

### Alternatives Considered

- _TypeScript interfaces without Zod runtime validation:_ Rejected because LLM outputs are inherently probabilistic and untrusted; strict Zod runtime parsing is required by the project specification.

---

## ADR 003: Deterministic Routing, Caps, and Review Interrupt (Phase 1)

- **Date:** 2026-11-03
- **Status:** Accepted

### Context

The system specifies two conditional routing junctions (Route A after Fact-checker, Route B after Editor) with bounded loops (max 2 research rounds, max 3 write cycles), open flag tracking, and human review interrupts.

### Decision

1. Implement pure deterministic routing functions (`routeAfterFactChecker`, `routeAfterEditor`) without an LLM supervisor.
2. Introduce a dedicated `prepareReview` node preceding `humanReview`. When caps are hit with unresolved flags (or when the editor accepts), `prepareReview` sets `status: 'awaiting_review'` and populates `openIssues` before the checkpoint is committed.
3. Use LangGraph's native `interrupt()` inside `humanReviewNode`. When resumed via `Command({ resume: HumanAction })`, the node resumes cleanly, records the human action, applies manual edits if provided, and transitions to `END`.
4. Enforce mathematical termination: because `researchRounds` and `writeCycles` strictly increment on each loop and routing checks enforce `< 2` and `< 3`, infinite loops are provably impossible.

### Alternatives Considered

- _LLM Supervisor for routing:_ Rejected per project brief specification; with 4 agents, a supervisor adds latency, monetary cost, and unnecessary failure modes.
- _Handling state mutation inside conditional edge:_ Rejected because LangGraph conditional edges are pure routing resolvers; node execution ensures state updates are properly saved to checkpoints.

---
