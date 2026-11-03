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
