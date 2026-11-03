# CiteWriter Production Deployment Guide

This guide details how to deploy CiteWriter in production across self-hosted Docker environments and managed cloud platforms (Railway, Render, Fly.io, Vercel).

---

## 1. System Topology & Architecture

CiteWriter comprises four primary operational components:

```
                            +--------------------------+
                            |     Browser Client       |
                            +------------+-------------+
                                         |
                                         | HTTPS (Next.js UI & SSR)
                                         v
                            +--------------------------+
                            |     Next.js Web App      |
                            |       (Port 3000)        |
                            +------------+-------------+
                                         |
                                         | REST & SSE Streams
                                         v
                            +--------------------------+
                            |       Fastify API        |
                            |       (Port 3001)        |
                            +---+------------------+---+
                                |                  |
          BullMQ Job Enqueue /  |                  | Durable Checkpoints &
          Event Pub/Sub Streams |                  | Application State
                                v                  v
                      +------------------+   +--------------------+
                      |   Redis Cache    |   | PostgreSQL 16 DB   |
                      |   (Port 6379)    |   |    (Port 5432)     |
                      +--------+---------+   +---------+----------+
                               ^                       ^
                               | BullMQ Job Execution  |
                               +-----------+-----------+
                                           |
                               +-----------+----------+
                               |    BullMQ Worker     |
                               | (LangGraph Execution)|
                               +----------------------+
```

---

## 2. Option A: Self-Hosted Docker Compose (Recommended for VPS)

The easiest way to run CiteWriter in production on an Ubuntu/Debian VPS, AWS EC2, or Hetzner server.

### Prerequisites

- Docker Engine $\ge 24.0$
- Docker Compose $\ge 2.20$
- Valid domain names (e.g., `citewriter.example.com` and `api.citewriter.example.com`)

### Step-by-Step Instructions

1. **Clone the repository:**

   ```bash
   git clone https://github.com/your-username/citewriter.git
   cd citewriter
   ```

2. **Configure production environment:**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and set secure credentials:
   - `DATABASE_URL`: `postgresql://citewriter:STRONG_POSTGRES_PASSWORD@postgres:5432/citewriter`
   - `REDIS_URL`: `redis://redis:6379`
   - `OPENROUTER_API_KEY`: Your OpenRouter API key (`sk-or-v1-...`)
   - `TAVILY_API_KEY`: Your Tavily API key (`tvly-...`)
   - `AUTH_SECRET`: Generate a random 32-character secret (`openssl rand -hex 32`)
   - `NEXT_PUBLIC_API_URL`: Your public API domain (`https://api.yourdomain.com`)

3. **Build and launch containers:**

   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

4. **Verify container health:**

   ```bash
   docker compose -f docker-compose.prod.yml ps
   ```

   All containers (`citewriter-postgres-prod`, `citewriter-redis-prod`, `citewriter-api-prod`, `citewriter-web-prod`) should report `healthy` or `running`.

5. **Test Readiness Probe:**
   ```bash
   curl -i http://localhost:3001/health/ready
   ```
   Expected response:
   ```json
   {
     "status": "ok",
     "service": "citewriter-api",
     "checks": {
       "database": "ok",
       "redis": "ok"
     },
     "timestamp": "2026-11-03T15:20:00.000Z"
   }
   ```

---

## 3. Option B: Cloud Platform Deployment (Railway / Render)

### Railway Deployment (Full Stack)

1. **Provision PostgreSQL & Redis:**
   - In your Railway project, click **New Service** $\rightarrow$ **Database** $\rightarrow$ **Add PostgreSQL**.
   - Click **New Service** $\rightarrow$ **Database** $\rightarrow$ **Add Redis**.

2. **Deploy Fastify API & Worker (`apps/api`):**
   - Click **New Service** $\rightarrow$ **GitHub Repo**.
   - Set **Root Directory** to `/`.
   - Set **Dockerfile Path** to `apps/api/Dockerfile`.
   - Add Environment Variables:
     - `DATABASE_URL`: `${{Postgres.DATABASE_URL}}`
     - `REDIS_URL`: `${{Redis.REDIS_URL}}`
     - `OPENROUTER_API_KEY`: Your OpenRouter key
     - `TAVILY_API_KEY`: Your Tavily key
     - `RESEARCHER_MODEL`: `openai/gpt-4o-mini`
     - `WRITER_MODEL`: `openai/gpt-4o`
     - `FACT_CHECKER_MODEL`: `openai/gpt-4o-mini`
     - `EDITOR_MODEL`: `openai/gpt-4o`
     - `MAX_RUN_TOKENS`: `100000`
     - `MAX_RUN_COST_USD`: `1.50`
   - Set **Healthcheck Path** to `/health/ready`.
   - Generate a Railway public domain (e.g. `https://citewriter-api-production.up.railway.app`).

3. **Deploy Next.js Frontend (`apps/web`):**
   - Click **New Service** $\rightarrow$ **GitHub Repo**.
   - Set **Root Directory** to `/`.
   - Set **Dockerfile Path** to `apps/web/Dockerfile`.
   - Add Environment Variables:
     - `NEXT_PUBLIC_API_URL`: `https://citewriter-api-production.up.railway.app`
     - `API_URL`: `https://citewriter-api-production.up.railway.app`
   - Generate a Railway public domain (e.g. `https://citewriter.up.railway.app`).

---

## 4. Option C: Hybrid Deployment (Vercel Frontend + Fly.io / Railway Backend)

- **Frontend on Vercel:**
  - Connect your repository to Vercel.
  - Set **Root Directory** to `apps/web`.
  - Framework Preset: **Next.js**.
  - Add Environment Variable:
    - `NEXT_PUBLIC_API_URL`: Your backend API URL.

- **Backend on Fly.io:**
  - Fly.io supports deploying the Docker container with `fly launch --dockerfile apps/api/Dockerfile`.
  - Connect to managed Postgres (Fly Postgres or Supabase) and Upstash Redis.

---

## 5. Database Migrations & Checkpointer Tables

When the API server starts up in production:

1. `createPostgresCheckpointer(dbCtx.pool).setup()` is automatically executed on startup, idempotently provisioning LangGraph checkpoint tables:
   - `checkpoints`
   - `checkpoint_blobs`
   - `checkpoint_writes`
   - `checkpoint_migrations`
2. Run database table schemas (`users`, `runs`, `run_events`, `draft_versions`) can be pushed via Drizzle:
   ```bash
   pnpm --filter @citewriter/api run db:push
   ```

---

## 6. Observability & Tracing (Langfuse)

To trace production LLM calls with token, latency, and cost telemetry:

1. Create a free account at [Langfuse](https://cloud.langfuse.com).
2. Set the following environment variables:
   - `LANGFUSE_PUBLIC_KEY`: `pk-lf-...`
   - `LANGFUSE_SECRET_KEY`: `sk-lf-...`
   - `LANGFUSE_BASEURL`: `https://cloud.langfuse.com`
3. Every agent step and LLM invocation will automatically log spans with prompt parameters, token counts, and cost breakdown.

---

## 7. Scaling Workers Horizontally

BullMQ queues decouple HTTP request acceptance from LLM graph execution:

- To scale worker processing throughput under heavy load:
  ```bash
  docker compose -f docker-compose.prod.yml up -d --scale api=3
  ```
- Because LangGraph checkpoints are persisted to PostgreSQL (`thread_id = runId`), any worker node can safely resume execution or handle revision loops without shared in-memory state.
