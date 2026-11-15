# CiteWriter API Documentation

The CiteWriter API is a high-performance REST and Server-Sent Events (SSE) service powered by **Fastify**, **BullMQ**, and **PostgreSQL**. It orchestrates the multi-agent editorial pipeline, persists durable graph checkpoints, and streams real-time agent verification updates to connected clients.

---

## 1. Overview & Base URL

- **Default Local Base URL:** `http://localhost:3001`
- **Default Content Type:** `application/json`
- **Streaming Protocol:** Server-Sent Events (`text/event-stream`)
- **Maximum Request Body Size:** 1 MB (requests exceeding 1 MB are rejected with HTTP 413 `PAYLOAD_TOO_LARGE`)

---

## 2. Authentication & Demo Protection

All `/runs` endpoints require demo authentication via the `X-Access-Code` header:

```http
X-Access-Code: citewriter_demo_2026
```

- **Constant-Time Verification:** The API compares the supplied header against the server's configured `ACCESS_CODE` in constant time (`crypto.timingSafeEqual` over SHA-256 digests) to prevent timing side-channel attacks.
- **Identity Isolation:** Client-supplied `x-user-id` headers are ignored. A deterministic identity (`demo_user_<hash>`) is derived and provisioned in PostgreSQL only after the access code passes verification.
- **Unauthorized Failure (HTTP 401):** If the access code is missing or does not match, the API immediately halts execution and returns HTTP 401 without querying or creating database records.

---

## 3. Global Caps & Rate Limiting

The API enforces four layers of protection against quota exhaustion and resource abuse:

| Limit | Environment Variable | Default Value | Exceeded Status Code & Code |
| :--- | :--- | :--- | :--- |
| **Global Concurrency** | `MAX_CONCURRENT_RUNS` | `1` | `429` (`GLOBAL_CONCURRENCY_EXCEEDED`) |
| **Global Daily Cap** | `MAX_RUNS_PER_DAY` | `10` | `429` (`GLOBAL_DAILY_CAP_EXCEEDED`) |
| **Per-IP Daily Cap** | `MAX_RUNS_PER_IP_PER_DAY` | `5` | `429` (`IP_DAILY_CAP_EXCEEDED`) |
| **Model Quota Headroom** | `LEDGER_HEADROOM_TOKENS` | `25,000` | `429` (`QUOTA_EXHAUSTED`) |
| **IP Request Rate** | `@fastify/rate-limit` | `100 req/min` | `429` (`RATE_LIMIT_EXCEEDED`) |

When any cap is breached, the API returns HTTP 429 with a descriptive message and an actionable `retryHint`.

---

## 4. Endpoints Reference

### 4.1. Start a New Run

Creates a new run record in `pending` status and enqueues an `execute-run` background job in BullMQ.

- **Method:** `POST`
- **Path:** `/runs`
- **Headers:**
  - `Content-Type: application/json`
  - `X-Access-Code: <ACCESS_CODE>` (Required)

#### Request Body Schema

```json
{
  "topic": "string (min 3, max 1000 characters, required)",
  "sourceUrl": "string (valid http/https URL, optional)",
  "config": {
    "audience": "string (optional, default: 'engineers and technical readers')",
    "tone": "string (optional, default: 'authoritative, clear, and informative')",
    "format": "'article' | 'twitter_thread' | 'linkedin_post' (optional, default: 'article')",
    "targetWords": "number (positive integer, optional, default: 400)",
    "maxTokens": "number (positive integer, optional)",
    "maxCostUsd": "number (positive float, optional)"
  }
}
```

#### Example Request

```bash
curl -X POST http://localhost:3001/runs \
  -H "Content-Type: application/json" \
  -H "X-Access-Code: citewriter_demo_2026" \
  -d '{
    "topic": "PostgreSQL MVCC and WAL Durability Mechanisms",
    "config": {
      "format": "article",
      "targetWords": 500
    }
  }'
```

#### Example Response (`201 Created`)

```json
{
  "id": "run_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "userId": "demo_user_e3b0c44298fc",
  "topic": "PostgreSQL MVCC and WAL Durability Mechanisms",
  "sourceUrl": null,
  "config": {
    "audience": "engineers and technical readers",
    "tone": "authoritative, clear, and informative",
    "format": "article",
    "targetWords": 500
  },
  "status": "pending",
  "mode": "mock",
  "ip": "127.0.0.1",
  "draft": "",
  "claims": [],
  "claimChecks": [],
  "editorVerdict": null,
  "notes": [],
  "researchRounds": 0,
  "writeCycles": 0,
  "openIssues": [],
  "tokensUsed": 0,
  "costUsd": 0,
  "agentMetrics": {},
  "createdAt": "2026-11-15T16:00:00.000Z",
  "updatedAt": "2026-11-15T16:00:00.000Z"
}
```

---

### 4.2. List Runs

Returns a list of recent runs for the authenticated user.

- **Method:** `GET`
- **Path:** `/runs`
- **Headers:**
  - `X-Access-Code: <ACCESS_CODE>` (Required)

#### Example Response (`200 OK`)

```json
{
  "runs": [
    {
      "id": "run_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "topic": "PostgreSQL MVCC and WAL Durability Mechanisms",
      "status": "awaiting_review",
      "mode": "mock",
      "tokensUsed": 2450,
      "costUsd": 0.00368,
      "createdAt": "2026-11-15T16:00:00.000Z",
      "updatedAt": "2026-11-15T16:00:15.000Z"
    }
  ]
}
```

---

### 4.3. Get Run Detail

Retrieves complete run details including the generated Markdown draft, verified primary notes, parsed claims, and fact-checker verdicts.

- **Method:** `GET`
- **Path:** `/runs/:id`
- **Headers:**
  - `X-Access-Code: <ACCESS_CODE>` (Required)

#### Example Response (`200 OK`)

```json
{
  "id": "run_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "topic": "PostgreSQL MVCC and WAL Durability Mechanisms",
  "status": "awaiting_review",
  "mode": "mock",
  "draft": "# PostgreSQL MVCC Architecture\n\nIn PostgreSQL, heap tuples record xmin and xmax transaction IDs [n1].\n\nChanges are written to write-ahead logs prior to writing modified pages to disk [n2].",
  "notes": [
    {
      "id": "n1",
      "claim": "PostgreSQL records xmin and xmax transaction IDs in heap tuple headers.",
      "sourceUrl": "https://www.postgresql.org/docs/current/storage.html",
      "quote": "In PostgreSQL, each heap tuple header records xmin for the inserting transaction ID and xmax for the deleting or updating transaction ID.",
      "retrievedAt": "2026-11-15T16:00:05.000Z"
    }
  ],
  "claims": [
    {
      "claim": "In PostgreSQL, heap tuples record xmin and xmax transaction IDs.",
      "sentence": "In PostgreSQL, heap tuples record xmin and xmax transaction IDs [n1].",
      "noteIds": ["n1"],
      "startIndex": 32,
      "endIndex": 105
    }
  ],
  "claimChecks": [
    {
      "claim": "In PostgreSQL, heap tuples record xmin and xmax transaction IDs.",
      "noteIds": ["n1"],
      "status": "supported",
      "reason": "Directly grounded in note n1 verbatim quote."
    }
  ],
  "editorVerdict": {
    "score": 9,
    "decision": "accept",
    "feedback": "Clear, technically rigorous, fully grounded.",
    "rubricBreakdown": {
      "grounding": 10,
      "structure": 9,
      "tone": 9,
      "length": 8
    }
  },
  "tokensUsed": 2450,
  "costUsd": 0.00368,
  "agentMetrics": {
    "researcher": { "tokensUsed": 650, "costUsd": 0.00065, "calls": 1 },
    "writer": { "tokensUsed": 850, "costUsd": 0.00170, "calls": 1 },
    "factChecker": { "tokensUsed": 550, "costUsd": 0.00083, "calls": 1 },
    "editor": { "tokensUsed": 400, "costUsd": 0.00050, "calls": 1 }
  }
}
```

---

### 4.4. Server-Sent Events (SSE) Stream with Reconnection

Opens a real-time event stream providing live updates as the graph executes through Researcher, Writer, Fact-checker, and Editor nodes.

- **Method:** `GET`
- **Path:** `/runs/:id/events`
- **Headers:**
  - `Accept: text/event-stream`
  - `X-Access-Code: <ACCESS_CODE>` (Required)
  - `Last-Event-ID: <sequence_number>` (Optional, enables lossless event replay)

#### SSE Reconnection Protocol

When a network drop occurs, the client includes `Last-Event-ID: N` in the reconnection request. The server queries `run_events` where `sequence_number > N`, replays missed historical events in order, and then seamlessly subscribes to live Redis events.

#### Example SSE Stream

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

id: 1
event: run_created
data: {"topic":"PostgreSQL MVCC","runId":"run_a1b2c3d4..."}

id: 2
event: node_start
data: {"node":"researcher","round":1}

id: 3
event: node_end
data: {"node":"researcher","notesCount":4}

id: 4
event: node_start
data: {"node":"writer","cycle":1}

id: 5
event: status_change
data: {"status":"awaiting_review","action":"human_review"}
```

---

### 4.5. Resume Run (Human Review)

Resumes an interrupted graph in `awaiting_review` status via LangGraph's `Command({ resume })` mechanism.

- **Method:** `POST`
- **Path:** `/runs/:id/resume`
- **Headers:**
  - `Content-Type: application/json`
  - `X-Access-Code: <ACCESS_CODE>` (Required)

#### Request Body Schema

```json
{
  "action": "'approve' | 'edit' | 'reject' (required)",
  "editedDraft": "string (required if action is 'edit', otherwise optional)",
  "feedback": "string (optional feedback when rejecting or revising)"
}
```

#### Example Request

```bash
curl -X POST http://localhost:3001/runs/run_a1b2c3d4.../resume \
  -H "Content-Type: application/json" \
  -H "X-Access-Code: citewriter_demo_2026" \
  -d '{
    "action": "approve"
  }'
```

#### Example Response (`200 OK`)

```json
{
  "message": "Run resume submitted successfully",
  "runId": "run_a1b2c3d4...",
  "action": "approve",
  "status": "resuming"
}
```

---

### 4.6. Cancel Run

Safely aborts an active or pending run, sets its status to `rejected`, and prevents further agent turns.

- **Method:** `POST`
- **Path:** `/runs/:id/cancel`
- **Headers:**
  - `X-Access-Code: <ACCESS_CODE>` (Required)

#### Example Response (`200 OK`)

```json
{
  "message": "Run canceled successfully",
  "runId": "run_a1b2c3d4...",
  "status": "canceled"
}
```

---

### 4.7. Health Checks

#### Liveness Probe & Execution Mode (`GET /health`)

Returns server liveness, package core version, and active execution mode (`real` or `mock`).

```bash
curl http://localhost:3001/health
```

```json
{
  "status": "ok",
  "service": "citewriter-api",
  "mode": "mock",
  "coreVersion": "0.1.0",
  "timestamp": "2026-11-15T16:00:00.000Z"
}
```

#### Deep Readiness Probe (`GET /health/ready`)

Verifies live connectivity to PostgreSQL (`SELECT 1`) and Redis (`PING`).

```bash
curl http://localhost:3001/health/ready
```

```json
{
  "status": "ok",
  "service": "citewriter-api",
  "checks": {
    "database": "ok",
    "redis": "ok"
  },
  "timestamp": "2026-11-15T16:00:00.000Z"
}
```

---

## 5. SSE Event Types Reference

| Event Name | Node / Source | Data Payload Description |
| :--- | :--- | :--- |
| `run_created` | API Server | Emitted immediately upon initial job enqueue with `topic` and `runId`. |
| `node_start` | LangGraph Worker | Emitted when an agent node begins execution (`node`: `researcher`, `writer`, `factChecker`, `editor`). |
| `node_end` | LangGraph Worker | Emitted upon agent node completion with intermediate outputs and token counts. |
| `status_change` | LangGraph Worker | Emitted on state transitions (`running`, `awaiting_review`, `approved`, `rejected`, `budget_exceeded`). |
| `error` | LangGraph Worker | Emitted if an unrecoverable agent failure or validation error occurs. |

---

## 6. Error Codes and Status Matrix

The API returns structured JSON error objects across all failure scenarios:

```json
{
  "statusCode": 429,
  "error": "Too Many Requests",
  "code": "GLOBAL_CONCURRENCY_EXCEEDED",
  "message": "Global concurrent run limit reached (1 active run allowed). Please wait for the current run to complete.",
  "retryHint": "Wait for the active run to complete before starting a new run."
}
```

| HTTP Status | Error Code (`code`) | Trigger Condition |
| :--- | :--- | :--- |
| **400 Bad Request** | `VALIDATION_ERROR` | Request payload failed Zod schema validation (e.g. topic under 3 chars, negative word count, invalid resume action). |
| **401 Unauthorized** | `Unauthorized` | Missing or incorrect `X-Access-Code` header. |
| **404 Not Found** | `NOT_FOUND` | Run ID not found in database, or unmapped HTTP route. |
| **413 Payload Too Large** | `PAYLOAD_TOO_LARGE` | HTTP request body exceeded 1 MB limit. |
| **429 Too Many Requests** | `GLOBAL_CONCURRENCY_EXCEEDED` | Exceeded `MAX_CONCURRENT_RUNS` active executions globally. |
| **429 Too Many Requests** | `GLOBAL_DAILY_CAP_EXCEEDED` | Exceeded `MAX_RUNS_PER_DAY` across all users in the current UTC day. |
| **429 Too Many Requests** | `IP_DAILY_CAP_EXCEEDED` | Exceeded `MAX_RUNS_PER_IP_PER_DAY` for the client's IP in the current UTC day. |
| **429 Too Many Requests** | `QUOTA_EXHAUSTED` | Real-mode model token ledger has less remaining quota than `LEDGER_HEADROOM_TOKENS` (default 25,000). |
| **429 Too Many Requests** | `RATE_LIMIT_EXCEEDED` | Exceeded Fastify IP rate limit (100 req/min). |
| **500 Internal Error** | `INTERNAL_SERVER_ERROR` | Unexpected unhandled server exception. |
| **503 Service Unavailable** | `degraded` | Database or Redis ping failed during `/health/ready` check. |
