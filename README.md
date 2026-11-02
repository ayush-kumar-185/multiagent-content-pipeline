# CiteWriter

> **A multi-agent editorial system that researches, writes, fact-checks, and refines technical articles with sentence-level verifiable citations.**

CiteWriter orchestrates four cooperative LangGraph.js agents (Researcher, Writer, Fact-checker, Editor) to generate accurate, publication-ready technical writing. Every factual claim is strictly linked to primary web sources, verified through automated quote extraction and deterministic validation rules, bounded by strict cost/token budgets, and finalized with human-in-the-loop review.

---

## Tech Stack

- **Monorepo:** pnpm workspaces
- **Language:** TypeScript (Strict mode)
- **Agent Orchestration:** LangGraph.js (`@langchain/langgraph`)
- **Schema Validation:** Zod
- **Backend API & Queue:** Node.js, Fastify, BullMQ, Redis
- **Database & Checkpointer:** PostgreSQL, Drizzle ORM
- **Frontend:** Next.js (App Router), Tailwind CSS, shadcn/ui
- **Testing:** Vitest
- **Local Infrastructure:** Docker Compose (PostgreSQL, Redis)
- **Observability:** Langfuse

---

## Monorepo Layout

```
apps/
  web/          # Next.js App Router frontend & review UI
  api/          # Fastify API server & BullMQ background worker
packages/
  core/         # Pure LangGraph pipeline, agents, schemas, tools (no DB/web coupling)
  evals/        # Benchmark topics, single-prompt baselines, scoring scripts, reports
docs/
  architecture.md   # Architectural design and flowcharts
  DECISIONS.md      # Architecture Decision Records (ADRs)
  FAILURES.md       # Real bug analysis, edge case logs, and resolutions
```

---

## Getting Started

### Prerequisites

- Node.js >= 20 (Node 24 recommended)
- pnpm >= 9
- Docker & Docker Compose

### Local Development Setup

1. **Clone the repository and install dependencies:**

   ```bash
   pnpm install
   ```

2. **Configure environment variables:**

   ```bash
   cp .env.example .env
   ```

3. **Start infrastructure services (PostgreSQL & Redis):**

   ```bash
   docker compose up -d
   ```

4. **Run tests across all workspaces:**

   ```bash
   pnpm test
   ```

5. **Typecheck and Lint:**
   ```bash
   pnpm typecheck
   pnpm lint
   ```

---

## Documentation

- [Build Brief](CiteWriter%20Coding%20Agent%20Build%20Brief.md)
- [Agent Specifications](AGENTS.md)
- [Architecture Details](docs/architecture.md)
- [Decision Records](docs/DECISIONS.md)
- [Failure Log](docs/FAILURES.md)
