# CiteWriter Environment Variables Setup Guide

This document provides a complete reference for all key-value pairs in the CiteWriter [`.env`](file:///c:/Users/Ayush/OneDrive/Desktop/MACP/.env) file, including default values, where to acquire API tokens, and recommended configurations.

---

## 1. Quick-Start Configuration (Recommended Stack)

If you are using **OpenRouter** (for unified LLM access) and **Tavily** (for web research), your `.env` should look like this:

```env
# ==============================================================================
# Database & Cache (Pre-configured for local Docker)
# ==============================================================================
DATABASE_URL=postgresql://citewriter:citewriter_dev_password@localhost:5433/citewriter
REDIS_URL=redis://localhost:6379

# ==============================================================================
# Service Ports & URLs
# ==============================================================================
PORT=3001
API_URL=http://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:3001
WEB_URL=http://localhost:3000
NODE_ENV=development

# ==============================================================================
# Agent Models (OpenRouter Model Identifiers)
# ==============================================================================
RESEARCHER_MODEL=openai/gpt-4o-mini
WRITER_MODEL=openai/gpt-4o
FACT_CHECKER_MODEL=openai/gpt-4o-mini
EDITOR_MODEL=openai/gpt-4o

# ==============================================================================
# LLM Provider API Keys & Base URLs
# ==============================================================================
OPENROUTER_API_KEY=sk-or-v1-your-actual-openrouter-key-here
OPENAI_API_KEY=
OPENAI_BASE_URL=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=

# ==============================================================================
# Search Tool (Tavily Search API)
# ==============================================================================
SEARCH_PROVIDER=tavily
TAVILY_API_KEY=tvly-your-actual-tavily-key-here
BRAVE_SEARCH_API_KEY=

# ==============================================================================
# Budget Guard Limits (Per Run Caps)
# ==============================================================================
MAX_RUN_TOKENS=100000
MAX_RUN_COST_USD=1.50

# ==============================================================================
# Observability (Langfuse - Optional)
# ==============================================================================
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASEURL=https://cloud.langfuse.com

# ==============================================================================
# Authentication (Auth.js)
# ==============================================================================
AUTH_SECRET=changeme_in_production_min_32_chars_random_string
NEXTAUTH_URL=http://localhost:3000
```

---

## 2. Complete Key-Value Pair Reference

### A. Database & Redis Cache

| Variable       | Required? | Default Value                                                               | Description                                                                                                  |
| :------------- | :-------- | :-------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | **Yes**   | `postgresql://citewriter:citewriter_dev_password@localhost:5433/citewriter` | Connection string for PostgreSQL. Works out of the box with the Docker container mapped to port `5433`.      |
| `REDIS_URL`    | **Yes**   | `redis://localhost:6379`                                                    | Redis connection URL for BullMQ job queue and live SSE event streams. Works with Docker container on `6379`. |

---

### B. Network Ports & Host URLs

| Variable              | Required? | Default Value           | Description                                                                            |
| :-------------------- | :-------- | :---------------------- | :------------------------------------------------------------------------------------- |
| `PORT`                | Optional  | `3001`                  | Port on which the Fastify backend API listens.                                         |
| `API_URL`             | Optional  | `http://localhost:3001` | Backend API URL used for internal server-side requests.                                |
| `NEXT_PUBLIC_API_URL` | **Yes**   | `http://localhost:3001` | Public API URL accessible by the browser frontend for SSE live streams and REST calls. |
| `WEB_URL`             | Optional  | `http://localhost:3000` | URL where the Next.js frontend is served.                                              |
| `NODE_ENV`            | Optional  | `development`           | Environment mode (`development`, `test`, or `production`).                             |

---

### C. Agent Model Selection

CiteWriter uses a provider-agnostic LLM client. Models are configured per agent role, allowing you to use fast/cheap models for extraction and capable frontier models for writing and editorial review.

| Variable             | Recommended Value    | Role Description                                                                    |
| :------------------- | :------------------- | :---------------------------------------------------------------------------------- |
| `RESEARCHER_MODEL`   | `openai/gpt-4o-mini` | Summarizes fetched web pages and extracts verbatim quote notes.                     |
| `WRITER_MODEL`       | `openai/gpt-4o`      | Drafts and revises the article, ensuring every sentence cites note IDs like `[n1]`. |
| `FACT_CHECKER_MODEL` | `openai/gpt-4o-mini` | Verifies claims against source notes and checks numbers/dates.                      |
| `EDITOR_MODEL`       | `openai/gpt-4o`      | Scores article quality against the rubric and requests targeted revisions.          |

_Note: If using direct OpenAI instead of OpenRouter, omit the `openai/` prefix (e.g. `gpt-4o` and `gpt-4o-mini`)._

---

### D. LLM Provider Credentials

_You only need **ONE** provider configured:_

| Variable             | Provider                       | Where to Get API Keys                                                                                                                                                  |
| :------------------- | :----------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY` | **OpenRouter** _(Recommended)_ | 1. Sign up at [https://openrouter.ai](https://openrouter.ai)<br>2. Navigate to **Keys** $\rightarrow$ **Create Key**<br>3. Copy the token starting with `sk-or-v1-...` |
| `OPENAI_API_KEY`     | **OpenAI** _(Alternative)_     | 1. Sign up at [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)<br>2. Create secret key starting with `sk-proj-...`                         |
| `OPENAI_BASE_URL`    | Custom Endpoint                | Optional. Leave empty unless using a local vLLM, Ollama, or proxy gateway.                                                                                             |
| `ANTHROPIC_API_KEY`  | Anthropic                      | Optional. Only needed if calling Anthropic directly without OpenRouter.                                                                                                |
| `GEMINI_API_KEY`     | Google Gemini                  | Optional. Only needed if calling Gemini directly.                                                                                                                      |

---

### E. Web Search Provider (Researcher Agent)

The Researcher agent requires access to a search engine to discover primary sources.

| Variable               | Value               | Where to Get API Keys                                                                                                                                              |
| :--------------------- | :------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SEARCH_PROVIDER`      | `tavily` or `brave` | Choose `tavily` (default) or `brave`.                                                                                                                              |
| `TAVILY_API_KEY`       | `tvly-...`          | 1. Sign up at [https://app.tavily.com](https://app.tavily.com)<br>2. Free tier provides **1,000 search queries per month**.<br>3. Copy API key from the dashboard. |
| `BRAVE_SEARCH_API_KEY` | `BSA...`            | 1. Sign up at [https://brave.com/search/api/](https://brave.com/search/api/)<br>2. Choose the Data API free tier.<br>3. Copy your API key.                         |

---

### F. Budget Guard Limits (Cost Control)

CiteWriter enforces deterministic token and cost limits before every LLM call to prevent accidental budget overruns:

| Variable           | Default Value | Description                                                                                                                                                 |
| :----------------- | :------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_RUN_TOKENS`   | `100000`      | Maximum accumulated tokens allowed across all 4 agents in a single article run.                                                                             |
| `MAX_RUN_COST_USD` | `1.50`        | Maximum estimated USD cost allowed per run. If exceeded, the run halts gracefully and routes partial drafts to Human Review with `status: budget_exceeded`. |

---

### G. Observability & Telemetry (Langfuse - Optional)

CiteWriter instruments every LLM generation, tool execution (`web_search`, `fetch_page`), and agent span with Langfuse tracing.

| Variable              | Default Value                | Where to Get API Keys                                                                                                                                                                                        |
| :-------------------- | :--------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LANGFUSE_PUBLIC_KEY` | _(Optional)_                 | 1. Sign up at [https://cloud.langfuse.com](https://cloud.langfuse.com) (free cloud tier).<br>2. Create a project $\rightarrow$ **Settings** $\rightarrow$ **API Keys**.<br>3. Copy Public Key (`pk-lf-...`). |
| `LANGFUSE_SECRET_KEY` | _(Optional)_                 | Copy Secret Key (`sk-lf-...`) from the same page.                                                                                                                                                            |
| `LANGFUSE_BASEURL`    | `https://cloud.langfuse.com` | Langfuse host URL (`https://us.cloud.langfuse.com` or self-hosted endpoint).                                                                                                                                 |

> [!NOTE]
> If `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are left blank, CiteWriter operates in **offline-safe in-memory fallback mode**. Traces, agent token breakdowns, and cost accounting will still work locally and display on the frontend without throwing network errors.

---

### H. Authentication (Auth.js)

| Variable       | Recommended Value           | Description                                                                                                            |
| :------------- | :-------------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`  | 32+ character random string | Secret key used to encrypt Auth.js session cookies and JWTs. For production, generate with: `openssl rand -base64 32`. |
| `NEXTAUTH_URL` | `http://localhost:3000`     | Canonical base URL of the frontend web application.                                                                    |

---

## 3. Verifying Your Configuration

Once your `.env` is populated:

1. **Verify Local Databases:**
   ```powershell
   docker compose up -d
   ```
2. **Run Monorepo Tests (Works without live keys via mock stubs):**
   ```powershell
   pnpm test
   ```
3. **Run Live Evaluation (With real OpenRouter/OpenAI and Tavily keys):**
   ```powershell
   pnpm --filter @citewriter/evals run eval
   ```
4. **Start Local Development Servers:**
   ```powershell
   # Terminal 1: Start Fastify API & BullMQ Worker
   pnpm --filter @citewriter/api run dev

   # Terminal 2: Start Next.js Frontend
   pnpm --filter @citewriter/web run dev
   ```
