# Architecture & Engineering Decision Records (ADR)

This document records architectural, engineering, and design decisions made throughout the development of CiteWriter, documenting what was chosen, why, and what alternatives were considered.

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
