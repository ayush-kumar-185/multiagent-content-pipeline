# CiteWriter Architecture

## Overview

CiteWriter is a multi-agent system built with TypeScript and LangGraph.js that turns a topic or source URL into a verified, technical article where every factual sentence is cited against primary web sources.

```
                           +----------------------+
                           |        Topic         |
                           +----------+-----------+
                                      |
                                      v
                           +----------------------+
                           |      Researcher      | <----------+
                           +----------+-----------+            |
                                      |                        |
                                      v                        |
                           +----------------------+            |
                           |        Writer        | <----+     |
                           +----------+-----------+      |     |
                                      |                  |     |
                                      v                  |     |
                           +----------------------+      |     |
                           |     Fact-checker     |      |     |
                           +----------+-----------+      |     |
                                      |                  |     |
                     (Route A)        +------------------+     |
                     - needs_more_research --------------------+
                     - unsupported ----------------------+
                     - all supported
                                      |
                                      v
                           +----------------------+
                           |        Editor        |
                           +----------+-----------+
                                      |
                     (Route B)        |
                     - revise --------+
                     - accept
                                      |
                                      v
                           +----------------------+
                           |     Human Review     |
                           |     (interrupt)      |
                           +----------+-----------+
                                      |
                           +----------v-----------+
                           |  Approve/Edit/Reject |
                           +----------------------+
```

## System Components

1. **`packages/core`**:
   - Contains pure agent definitions, LangGraph state machine, typed Zod schemas, LLM provider wrappers, deterministic checks, and security-hardened tools.
   - Zero web or database dependencies. Can run standalone via Node scripts for offline eval and fast testing.

2. **`apps/api`**:
   - Fastify HTTP API and BullMQ worker.
   - Manages asynchronous runs, PostgreSQL persistence with Drizzle ORM, durable LangGraph checkpoints, and real-time Server-Sent Events (SSE) streaming with reconnection.

3. **`apps/web`**:
   - Next.js (App Router) interface with Tailwind CSS and shadcn/ui.
   - Live execution stream, claim-level verification inspection, interactive editor review, and run history.

4. **`packages/evals`**:
   - Benchmark topics, single-prompt baselines, scoring scripts, and automated quality/citation reporting.
