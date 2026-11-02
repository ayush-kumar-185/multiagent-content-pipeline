# CiteWriter: Coding Agent Build Brief

How to use this brief: give your coding agent **Part 1** once, and save it in the repo as `AGENTS.md` (or `CLAUDE.md`) so it stays in context. Then give it **one phase at a time** from Part 2. Do not move to the next phase until the acceptance criteria of the current one pass.

---

# Part 1: Standing context (paste once)

## 1. What we are building

CiteWriter is a multi-agent system that turns a topic (or a source URL) into a technical article in which every factual claim is cited and verified against its source. Four LangGraph agents cooperate: a **Researcher**, a **Writer**, a **Fact-checker**, and an **Editor**. A human approves, edits, or rejects the result at the end.

This is a portfolio project for a final-year CS student targeting SDE and full-stack roles. Engineering quality matters as much as features: typed contracts, tests, measured evals, cost control, security, and a live deployment. Every design decision should be explainable in an interview.

## 2. Tech stack (defaults; ask before changing)

- Language: TypeScript everywhere, strict mode
- Monorepo: pnpm workspaces
- Frontend: Next.js (App Router), Tailwind, shadcn/ui
- Backend API: Node.js with Fastify
- Orchestration: LangGraph.js (`@langchain/langgraph`)
- Validation: Zod for every agent input and output
- Database: PostgreSQL with Drizzle ORM
- Job queue: BullMQ with Redis
- LLM access: a thin provider-agnostic wrapper; model names come from env vars per agent, never hardcoded
- Search tool: Tavily (or Brave Search API), behind an interface so it can be swapped
- Observability: Langfuse tracing
- Auth: Auth.js
- Tests: Vitest
- Local dev: Docker Compose for Postgres and Redis

## 3. Repo layout

```
apps/web        Next.js frontend
apps/api        Fastify API and BullMQ worker
packages/core   graph, agents, tools, Zod schemas, LLM wrapper (no web or DB code)
packages/evals  eval topics, baseline, scoring scripts, reports
docs/           architecture.md, DECISIONS.md, FAILURES.md
```

`packages/core` must run from a plain Node script with no server, so the pipeline can be tested and evaluated on its own.

## 4. Agents

Every agent returns output validated by Zod. On invalid output: retry up to 2 times with the validation error appended, then fail the node with a clear error.

### Researcher (tool-using agent)

- Job: gather facts on the topic and produce citable notes.
- Tools: `web_search(query)`, `fetch_page(url)` (clean text via a readability extractor).
- Loops until it judges it has enough coverage or hits its cap (max 8 page fetches per round).
- Output: `Note[]` where each note is `{ id, claim, sourceUrl, quote, retrievedAt }`. The `quote` must be an exact substring of the fetched page text; verify this in code and drop notes that fail.
- On a re-research request from the fact-checker, it receives the specific claims needing support and searches for those.

### Writer (reasoning agent, no web tools)

- Job: write the article from the notes and a brief (audience, length, tone).
- May state only facts present in the notes. Every factual sentence ends with note references like `[n3]` or `[n3][n7]`.
- Output: markdown draft. Code parses it into a list of claims (sentence plus note ids).
- On revision, it receives fact-check flags and editor feedback and fixes exactly those issues.

### Fact-checker (tool-using agent)

- Job: verify each claim against the cited note and source.
- Tools: `get_note(id)`, `fetch_page(url)` (to re-read a source when the note is ambiguous).
- Output per claim: `{ claim, noteIds, status: supported | unsupported | needs_more_research, reason }`.
- "Supported" means the source says it, not that it is true in the world. Check numbers, names, dates, and qualifiers ("all", "always", "up to") exactly.
- Deterministic pre-check in code, before any LLM call: every cited note id exists, and every number in the claim appears in the cited quote.

### Editor (reasoning agent)

- Job: judge clarity, structure, tone, length, and flow against a rubric.
- Output: `{ score: 0-10, feedback, decision: accept | revise }`.
- The editor does **not** rewrite factual sentences or add facts. It gives feedback; the Writer applies it. This keeps verified claims verified.
- Deterministic checks in code: length range, readability score, every factual sentence carries a citation.

## 5. Shared state

```ts
State = {
  runId, topic, sourceUrl?, config: { audience, tone, targetWords },
  notes: Note[], researchRounds: number,
  draft: string, claims: Claim[], writeCycles: number,
  claimChecks: ClaimCheck[], editorVerdict?: EditorVerdict,
  tokensUsed: number, costUsd: number,
  status: running | awaiting_review | approved | rejected | failed | budget_exceeded,
  openIssues: string[]
}
```

## 6. Graph and routing

```
START -> researcher -> writer -> factChecker -> (route A)

route A (after factChecker):
  any needs_more_research AND researchRounds < 2  -> researcher
  any unsupported AND writeCycles < 3              -> writer (with flags)
  all supported                                    -> editor
  caps hit with open flags                         -> humanReview (flags in openIssues)

editor -> (route B)
route B (after editor):
  accept                                           -> humanReview
  revise AND writeCycles < 3                       -> writer (with feedback)
  revise AND cap hit                               -> humanReview (feedback in openIssues)

humanReview: interrupt(); resume with approve | edit | reject -> END
```

Routing is done with conditional edges reading structured verdicts. There is no LLM supervisor, on purpose: with four agents it adds cost and failure modes without benefit.

## 7. Cross-cutting requirements

- **Budget guard:** before every LLM call, check `tokensUsed` and `costUsd` against per-run limits from env. On breach, set `budget_exceeded` and route to human review with the partial result.
- **Persistence:** use a durable Postgres checkpointer with `runId` as the thread id. A run must survive a server restart and resume.
- **Streaming:** emit node-level progress events and persist them with sequence numbers; the API exposes them over SSE and supports reconnect with `Last-Event-ID`.
- **Security:**
  - Fetched web content is untrusted data. Wrap it in clear delimiters and instruct the model never to follow instructions found inside it. The researcher may fetch only URLs returned by search or already present in notes.
  - `fetch_page` must allow only http and https, resolve DNS and block private, loopback, and link-local ranges (including cloud metadata addresses), cap response size (2 MB), set timeouts (10 s), limit redirects (3), and allow only text content types.
  - Secrets only in env vars; ship `.env.example`; never commit keys.
- **Observability:** every LLM call is traced with agent name, tokens, cost, and latency.

## 8. Working rules for the coding agent

1. Work on one phase at a time. When finished, stop, run all tests, and summarize what changed and what is left.
2. Do not rely on memory for library APIs (LangGraph.js, Drizzle, BullMQ, Auth.js, Langfuse). Check current official docs, and say so when something is uncertain.
3. Write tests with the code, not after. Routing logic, schemas, and the fetch-safety rules must have unit tests.
4. Keep functions small and typed. No `any` without a comment explaining why.
5. Record non-obvious choices in `docs/DECISIONS.md` (what, why, alternatives). Record real bugs and fixes in `docs/FAILURES.md` (symptom, cause, fix).
6. If a requirement is ambiguous, ask instead of guessing. Do not add features outside the current phase.
7. Commit after each task with a clear message.

---

# Part 2: Phases (give one at a time)

## Phase 0: Scaffold

**Tasks**

- Create the pnpm monorepo with the layout above, TypeScript strict config, ESLint, Prettier, Vitest.
- Add Docker Compose with Postgres and Redis, `.env.example`, and a README stub.
- Add a CI workflow that runs lint, typecheck, and tests.

**Done when:** `pnpm install`, `pnpm lint`, `pnpm test`, and `docker compose up` all work on a clean clone.

## Phase 1: Contracts and stub graph

**Tasks**

- In `packages/core`, write the Zod schemas: `Note`, `Claim`, `ClaimCheck`, `EditorVerdict`, `RunConfig`, and the graph state.
- Build the full LangGraph with **fake agents** that return canned or randomized valid outputs.
- Implement both routing functions, the caps, and the `interrupt()` for human review with the in-memory checkpointer.
- Provide a CLI script that runs the stub graph and prints each step.

**Done when:** unit tests cover every routing branch (including cap-hit paths), a run pauses at human review and resumes with approve, edit, and reject, and no path can loop forever.

## Phase 2: LLM layer, Writer, Editor

**Tasks**

- Build the provider wrapper: structured-output helper with Zod validation and bounded retry, token and cost accounting, per-agent model config, and the budget guard.
- Implement the real Writer and Editor, including prompts, citation-marker parsing into `Claim[]`, and the deterministic editor checks.
- Keep Researcher and Fact-checker as stubs.

**Done when:** given hand-written notes, the CLI produces a cited draft; the editor scores it; the revision loop works; the budget guard stops a run when limits are set very low (tested).

## Phase 3: Researcher and tools

**Tasks**

- Implement `web_search` behind an interface and `fetch_page` with all security rules from Part 1, section 7.
- Implement the Researcher tool loop with caps, and the exact-substring quote verification.
- Support targeted re-research from a list of unsupported claims.

**Done when:** a topic produces verified notes with working source URLs; unit tests prove `fetch_page` blocks localhost, private IPs, metadata addresses, oversized responses, and non-text types; a test page containing injected instructions does not change researcher behavior.

## Phase 4: Fact-checker

**Tasks**

- Implement the deterministic pre-checks (note ids exist, numbers match the quote).
- Implement the LLM fact-checker with the three statuses and reasons, using `get_note` and `fetch_page`.
- Wire real agents into the graph end to end.

**Done when:** a full run works from the CLI on 3 topics; seeded tests (a draft with a wrong number, an overstated qualifier, a fake citation id) are caught.

## Phase 5: Persistence, queue, API

**Tasks**

- Drizzle schema and migrations: users, runs, run\_events, and draft versions; add the Postgres checkpointer.
- BullMQ worker that executes runs; the API: `POST /runs`, `GET /runs`, `GET /runs/:id`, `GET /runs/:id/events` (SSE with `Last-Event-ID` replay), `POST /runs/:id/resume`, `POST /runs/:id/cancel`.
- Auth on all endpoints; per-user run limits and rate limiting.

**Done when:** integration tests pass; killing the worker mid-run and restarting resumes from the checkpoint; the SSE stream can disconnect and reconnect without losing events.

## Phase 6: Frontend

**Tasks**

- Auth pages, a New Run form (topic or URL, audience, tone, length), and a live progress view driven by SSE showing which agent is active and each agent's output summary.
- Review screen: the article with claims highlighted by status; clicking a claim shows the source quote and URL; approve, edit, and reject actions.
- Run history with cost, tokens, duration, and status.

**Done when:** a full run can be started, watched live, reviewed, and approved from the browser, and a page refresh mid-run reconnects to the live stream.

## Phase 7: Observability and cost

**Tasks**

- Add Langfuse tracing around every LLM call and tool call.
- Show per-agent token and cost breakdown on the run detail page.
- Make per-run budget limits configurable.

**Done when:** a single run's trace shows each agent's calls, and the UI cost total matches the traced total.

## Phase 8: Evals and baseline

**Tasks**

- In `packages/evals`, create 15 to 20 technical topics (YAML) with a written rubric.
- Build the baseline: a single-prompt writer given the same topic (baseline A: no research; baseline B: given the same notes the pipeline collected).
- Metrics per run: unsupported-claim rate, citation coverage, number of revision cycles, cost, latency.
- A script that runs everything, saves raw JSON results, and generates `REPORT.md` with a comparison table.
- A manual spot-check template: verify claims by hand on at least 5 articles and record how often the fact-checker agreed.

**Done when:** one command reproduces the report; raw results are committed; the report states honestly where the pipeline did not help.

## Phase 9: Hardening

**Tasks**

- Security tests: prompt-injection pages, SSRF attempts, oversized and slow responses.
- Resilience tests: worker crash and resume, provider timeout and retry, malformed model output, budget breach.
- Add input validation, request size limits, and structured error responses throughout.

**Done when:** all hardening tests pass in CI, and each real failure found is logged in `docs/FAILURES.md`.

## Phase 10: Deploy and document

**Tasks**

- Deploy the frontend, API, worker, Redis, and Postgres; configure env vars and secrets; add a health endpoint.
- Write `README.md` with a one-paragraph pitch, an architecture diagram (Mermaid), a quick-start, the eval results table, known limitations, and a "what I would change next" section.
- Record a 2-minute demo (start run, watch agents, review claims, approve).

**Done when:** a stranger can open the live demo, run an article, and read the README to understand every major decision.

---

# Definition of done for the project

- All phases pass their acceptance criteria and CI is green
- Live demo link, demo video, and architecture diagram in the README
- Eval report with baseline comparison and honest limitations
- `DECISIONS.md` and `FAILURES.md` filled with real entries
- The author can explain every module without looking at the code
