# Failures & Incident Log

This document records real bugs, edge-case failures, and architectural issues discovered during development and testing, along with root causes and fixes.

---

## Log Template

```markdown
### [YYYY-MM-DD] Short Failure Title

- **Phase:** Phase X
- **Symptom:** What happened (error message, test failure, unexpected behavior).
- **Cause:** Why it happened (root cause analysis).
- **Fix:** What change resolved it and how it was verified.
```

---

### [2026-11-03] Model Substring Collision in Cost Accounting

- **Phase:** Phase 2 (LLM Layer)
- **Symptom:** Unit test for `estimateCostUsd('gpt-4o-mini', 1000, 1000)` returned \$0.0125 instead of \$0.00075.
- **Cause:** `MODEL_PRICING` keys were checked via `.find()` with substring matching (`model.includes(key)`). Because `'gpt-4o'` appeared before `'gpt-4o-mini'` in the pricing table, `'gpt-4o-mini'.includes('gpt-4o')` evaluated to `true`, mistakenly applying the full `gpt-4o` pricing tier.
- **Fix:** Implemented a two-stage lookup: first an exact dictionary lookup, followed by sorting pricing table keys by length in descending order so more specific model identifiers (e.g. `'gpt-4o-mini'`) are matched before their shorter substrings (`'gpt-4o'`).

---

### [2026-11-03] Citation Marker Removal Trailing Whitespace

- **Phase:** Phase 2 (Writer Agent)
- **Symptom:** Parsed claims had a leading space before sentence-ending punctuation (e.g. `"TypeScript 5.0 introduced ... inference ."` instead of `"inference."`).
- **Cause:** The regex stripped citation markers like ` [n1]` by replacing `[n1]` with empty string, leaving behind the leading space before the terminating punctuation mark.
- **Fix:** Added `.replace(/\s+([.,!?;:])/g, '$1')` in `citationParser.ts` to collapse spaces preceding punctuation.

---

### [2026-11-03] PostgreSQL Host Port Collision With Native Service

- **Phase:** Phase 5 (Persistence & API)
- **Symptom:** `error: password authentication failed for user "citewriter"` when connecting to `localhost:5432`.
- **Cause:** A native Windows PostgreSQL service (PID 7960) was already listening on `0.0.0.0:5432`, intercepting connection attempts before they reached the Docker container.
- **Fix:** Configured Docker Compose port mapping to `${POSTGRES_PORT:-5433}:5432` and updated `DATABASE_URL` in `.env` and `.env.example` to point to port `5433`.

---

### [2026-11-03] Run Cancellation Race Condition in BullMQ Worker State Transitions

- **Phase:** Phase 5 / Phase 6 (API & Worker Integration)
- **Symptom:** In `runs.test.ts`, `cancels a run via POST /runs/:id/cancel` failed intermittently with `expected 'running' to be 'rejected'`.
- **Cause:** When a run was canceled immediately after creation, `POST /runs/:id/cancel` wrote `status: 'rejected'` to the database. However, the background BullMQ worker that had just picked up the initial `execute-run` job read the run record while it was still `pending`, and subsequently executed `update(runs).set({ status: 'running' })` without checking if the run had transitioned to a terminal status in the interim, overwriting `'rejected'`.
- **Fix:** Converted the worker status transition to an atomic conditional update: `WHERE id = runId AND status NOT IN ('approved', 'rejected', 'failed')`. If zero rows are affected, the worker aborts execution immediately. Additionally, pending BullMQ jobs are cleaned up upon cancellation and the worker verifies cancellation before writing the final state.

---

### [2026-11-03] Zod v3 vs v4 Parser Incompatibility in Topic Schema Validation

- **Phase:** Phase 8 (Evals Suite)
- **Symptom:** Vitest threw `TypeError: Cannot read properties of undefined (reading 'run')` inside `TopicSchema.parse(raw)`.
- **Cause:** `packages/evals` specified `"zod": "^4.6.7"` while `@citewriter/core` exported `NoteSchema` created with `"zod": "^3.24.2"`. In Zod v4, schema parsing delegates to `inst._zod.run()`. When composing an array of Zod v3 schemas inside a Zod v4 `z.object()`, Zod v4 tried to call `_zod.run` on the v3 instance, which does not exist on v3 schemas.
- **Fix:** Standardized `packages/evals/package.json` to `"zod": "^3.24.2"`, matching `@citewriter/core` and the rest of the monorepo.

---

### [2026-11-03] Premature Sentence Splitting on Trailing Punctuation Before Citations

- **Phase:** Phase 8 (Evals Metrics Scorer)
- **Symptom:** In evaluation runs, CiteWriter citation coverage unexpectedly measured 20% instead of 100%.
- **Cause:** Note claims ended with a terminal period (e.g. `"Raft consensus guarantees safety."`). Concatenating citations as `"${n.claim} [${n.id}]."` created `"Raft consensus guarantees safety. [n1]."`. The naive sentence splitter `/(?<=[.!?])\s+/` split immediately after `"safety."`, leaving the primary sentence without a citation tag and isolating `"[n1]."` as a 5-character orphan.
- **Fix:** Stripped trailing punctuation from note claims with `.replace(/\.+$/, '')` before appending citation brackets, and enhanced sentence tokenization with negative lookahead `/(?<=[.!?])(?!\s*\[n\d+)\s+/` to ensure citations remain bonded to their parent sentence.

---

### [2026-11-03] Empty String Environment Variable Nullish Coalescing in LLM Client

- **Phase:** Phase 9 (Hardening & Resilience)
- **Symptom:** Unit test for budget breach resilience threw `Error: Missing credentials. Please pass an apiKey` when initializing `createLLMClient()`.
- **Cause:** In `.env`, `OPENAI_API_KEY=` was defined as an empty string `""`. In JavaScript/TypeScript, nullish coalescing `process.env.OPENAI_API_KEY ?? 'dummy-key'` evaluates to `""` because an empty string is neither `null` nor `undefined`. Passing `""` to the OpenAI SDK triggered its credentials validation error.
- **Fix:** Replaced nullish coalescing `??` with logical OR `||` (`process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || 'dummy-key'`) so falsy empty strings cleanly fall back to test credentials.

---

### [2026-11-03] DNS Timeout on Unresolvable Cloud Metadata Hostnames During SSRF Checks

- **Phase:** Phase 9 (Hardening & Security)
- **Symptom:** `validateUrlSecurity('http://metadata.google.internal/computeMetadata/v1/')` timed out after 5,000ms in Vitest on local developer workstations.
- **Cause:** `dns.lookup('metadata.google.internal')` forwarded queries to local ISP/router DNS servers, waiting for recursive resolution to fail.
- **Fix:** Added a pre-DNS static filter with a blocklist of known metadata domains (`metadata.google.internal`, `instance-data`) and internal suffixes (`.internal`, `.local`, `.lan`, `.corp`) that rejects instantly in `<1ms` without initiating network DNS queries.

---

### [2026-11-03] Shared BullMQ Queue Name Collision & Timeouts in Multi-Worker Tests

- **Phase:** Phase 9 (Test Suite Stability & Monorepo Concurrency)
- **Symptom:** `queue.test.ts` and `workerCrashResume.test.ts` intermittently timed out after 15,000ms - 20,000ms when running concurrently in Vitest (`apps/api/src/queue/workerCrashResume.test.ts:48:3` and `apps/api/src/queue/queue.test.ts:65:3`).
- **Cause:** All integration test suites (`runs.test.ts`, `queue.test.ts`, and `workerCrashResume.test.ts`) initialized BullMQ `Worker` and `Queue` instances using the identical default queue name `'citewriter-runs'`. When executed concurrently in Vitest, workers in one test suite consumed jobs enqueued by another test suite ("job stealing"), while `job.waitUntilFinished(queueEvents)` hung waiting for pub/sub completion events that never fired on that specific listener.
- **Fix:** Parameterized `createRunQueue` and `createRunWorker` to accept a customizable `queueName`. Configured dedicated, isolated queue names per test suite (`citewriter-runs-queue-test`, `citewriter-runs-crash-test`, `citewriter-runs-api-test`), added a dual wait pattern racing Redis pub/sub (`job.waitUntilFinished`) against direct database polling (`waitForStatus`), and increased Vitest test timeouts to 60s. Verified that all 30 test files and 140 tests pass deterministically.

---

### [2026-11-03] Shared Subscriber Redis Connection in QueueEvents Teardown

- **Phase:** Phase 10 (Test Suite Stability & Teardown)
- **Symptom:** In `apps/api/src/queue/queue.test.ts`, `afterAll` timed out with `Error: Hook timed out in 10000ms` during full monorepo test runs.
- **Cause:** `QueueEvents` was initialized sharing the identical `ioredis` instance as `Worker` and `Queue`. In BullMQ, `QueueEvents` puts its connection into Redis subscriber mode (`SUBSCRIBE`). When `afterAll` sequentially executed `await worker.close()`, `await queueEvents.close()`, and `await redis.quit()`, the shared connection in subscriber mode deadlocked or delayed teardown past Vitest's default 10,000ms hook threshold.
- **Fix:** Provided `QueueEvents` with a dedicated independent connection via `redis.duplicate()`, invoked `await worker.close(true)` to force immediate worker loop termination, and configured an explicit 30s hook timeout. Verified that `queue.test.ts` tears down cleanly in `<1s`.

---

### [2026-11-04] Monorepo Dotenv Scope and Fake Agent Default in Dev Server

- **Phase:** Phase 10 (End-to-End Product Testing)
- **Symptom:** Submitting a run in the web UI for topic `"Raft consensus algorithm..."` produced a canned draft titled `"# TypeScript 5.0 Advancements"`, and the interactive article was displayed below the review action box rather than at the top.
- **Cause:** Two distinct issues:
  1. `apps/api/src/start.ts` invoked `createRunWorker` without passing `useReal*` graph options. In `packages/core/src/graph/nodes.ts`, `useRealResearcher`, `useRealWriter`, etc., default to `false` (fake agents) for stub testing, which hardcodes the canned TypeScript 5.0 draft.
  2. In monorepo execution, running `pnpm --filter @citewriter/api run dev` runs with `process.cwd()` set to `apps/api`. Calling `dotenv.config()` without path resolution only looked for `apps/api/.env`, leaving `OPENROUTER_API_KEY` and `TAVILY_API_KEY` unpopulated and falling back to dummy keys.
- **Fix:**
  1. Updated `apps/api/src/start.ts` and `apps/api/src/queue/worker.ts` so that in non-test environments (`NODE_ENV !== 'test'`), `useReal*` flags automatically default to `true` when LLM credentials are present.
  2. Configured multi-path `dotenv` resolution in `client.ts`, `factory.ts`, and `start.ts` to search parent workspace root `.env` files (`../../.env`, `../.env`), and copied `.env` into `apps/api` and `apps/web`.
  3. Reordered `apps/web/src/app/runs/[id]/page.tsx` so `ClaimHighlightArticle` renders prominently at the top with interactive claim highlighting and source drawer, followed by `HumanReviewActions`.

