# CiteWriter Environment Variables Setup Guide

This document provides a complete reference for all key-value pairs in the CiteWriter [`.env`](file:///c:/Users/Ayush/OneDrive/Desktop/MACP/.env) file, including default values, where to acquire API tokens, and recommended configurations.

---

## 1. Quick-Start Configuration (Multi-Platform Architecture)

CiteWriter supports multi-platform AI APIs, allowing you to route each agent to its optimal platform:
- **Researcher:** Google AI Studio (Gemini Flash) or Groq for fast, reliable tool calling
- **Writer:** Cerebras (Llama 3.3 70B) or Groq for highest prose quality
- **Fact-checker:** Google AI Studio (Gemini Flash) for deep reading and massive context window
- **Editor:** Google AI Studio (Gemini Flash-Lite) or Ollama (local Llama 3.2) for fast rubric evaluation

```env
# ==============================================================================
# Database & Cache (Pre-configured for local Docker)
# ==============================================================================
DATABASE_URL=postgresql://citewriter:citewriter_dev_password@localhost:5433/citewriter
DATABASE_URL_TEST=postgresql://citewriter:citewriter_dev_password@localhost:5433/citewriter_test
REDIS_URL=redis://localhost:6379

# ==============================================================================
# Public Demo Protection & Rate Limits
# ==============================================================================
ACCESS_CODE=citewriter_demo_2026
MAX_RUNS_PER_DAY=10
MAX_CONCURRENT_RUNS=1
MAX_RUNS_PER_IP_PER_DAY=5
LEDGER_HEADROOM_TOKENS=25000

# ==============================================================================
# Execution Mode (Explicit Real vs Mock)
# ==============================================================================
USE_REAL_LLM=false

# ==============================================================================
# Service Ports & URLs
# ==============================================================================
PORT=3001
API_URL=http://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:3001
WEB_URL=http://localhost:3000
NODE_ENV=development

# ==============================================================================
# Agent Models & Platform Providers
# ==============================================================================
RESEARCHER_PROVIDER=gemini
RESEARCHER_MODEL=gemini-2.5-flash

WRITER_PROVIDER=cerebras
WRITER_MODEL=llama3.3-70b

FACT_CHECKER_PROVIDER=gemini
FACT_CHECKER_MODEL=gemini-2.5-flash

EDITOR_PROVIDER=gemini
EDITOR_MODEL=gemini-2.5-flash-lite

# ==============================================================================
# LLM Platform API Keys & Endpoints
# ==============================================================================
# 1. Google AI Studio (Gemini API)
GEMINI_API_KEY=your_gemini_api_key_here

# 2. Groq Cloud
GROQ_API_KEY=your_groq_api_key_here

# 3. Cerebras Cloud
CEREBRAS_API_KEY=your_cerebras_api_key_here

# 4. Ollama (Local Free Inference)
OLLAMA_BASE_URL=http://localhost:11434/v1

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

| Variable | Required? | Default Value | Description |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | **Yes** (Prod/Dev) | `postgresql://citewriter:citewriter_dev_password@localhost:5433/citewriter` | Connection string for PostgreSQL in dev/production environments. |
| `DATABASE_URL_TEST` | **Yes** (in test) | `postgresql://citewriter:citewriter_dev_password@localhost:5433/citewriter_test` | Dedicated test database connection. Required when `NODE_ENV=test` or `VITEST=true`; database name must end with `_test`. |
| `REDIS_URL` | **Yes** | `redis://localhost:6379` | Redis connection URL for BullMQ job queue and live SSE event streams. Works with Docker container on `6379`. |

---

### A.1 Public Demo Protection & Rate Limits

| Variable | Required? | Default Value | Description |
| :--- | :--- | :--- | :--- |
| `ACCESS_CODE` | **Yes** | `citewriter_demo_2026` | Required demo access code sent in `X-Access-Code` header on all `/runs` endpoints. Compared in constant time. |
| `MAX_RUNS_PER_DAY` | Optional | `10` | Global limit of run creations across all users per UTC day. Returns 429 when exceeded. |
| `MAX_CONCURRENT_RUNS` | Optional | `1` | Global maximum active runs in `pending` or `running` state. Returns 429 when exceeded. |
| `MAX_RUNS_PER_IP_PER_DAY` | Optional | `5` | Maximum runs created from a single IP address per UTC day. Returns 429 when exceeded. |
| `LEDGER_HEADROOM_TOKENS` | Optional | `25000` | Minimum token quota headroom required in real mode before enqueuing a run. Returns 429 if model quota is depleted. |
| `USE_REAL_LLM` | **Yes** | `false` | Explicit execution mode flag (`true` or `false`). When `true`, verifies provider keys at startup and fails fast if missing. |

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

### C. Agent Provider & Model Selection

CiteWriter uses a provider-agnostic LLM client with direct, native integration for **Google AI Studio (Gemini)**, **Groq**, **Cerebras**, and **Ollama**.

You can specify a provider per agent (`RESEARCHER_PROVIDER`, `WRITER_PROVIDER`, `FACT_CHECKER_PROVIDER`, `EDITOR_PROVIDER`), or set a global default using `LLM_PROVIDER`.

| Role | Provider Variable | Model Variable | Recommended Model | Best-fit Reason |
| :--- | :--- | :--- | :--- | :--- |
| **Researcher** | `RESEARCHER_PROVIDER` | `RESEARCHER_MODEL` | `gemini-2.5-flash` or `llama-3.3-70b-versatile` | Fast tool execution, reliable note quote extraction |
| **Writer** | `WRITER_PROVIDER` | `WRITER_MODEL` | `llama3.3-70b` | Highest prose quality and stylistic instruction adherence |
| **Fact-checker** | `FACT_CHECKER_PROVIDER` | `FACT_CHECKER_MODEL` | `gemini-2.5-flash` | Large context window, careful reading & verification |
| **Editor** | `EDITOR_PROVIDER` | `EDITOR_MODEL` | `gemini-2.5-flash-lite` or `llama3.2` | Fast, cost-efficient rubric evaluation and feedback |

---

### D. LLM Platform Credentials & Where to Get Keys

| Platform | Environment Variable | Where to Get API Keys / Setup |
| :--- | :--- | :--- |
| **Google AI Studio (Gemini API)** | `GEMINI_API_KEY` | 1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey)<br>2. Sign in with your Google account<br>3. Click **Create API Key** and copy it into `GEMINI_API_KEY` |
| **Groq Cloud** | `GROQ_API_KEY` | 1. Sign up at [Groq Console](https://console.groq.com/keys)<br>2. Navigate to **API Keys** $\rightarrow$ **Create API Key**<br>3. Copy the token into `GROQ_API_KEY` |
| **Cerebras Cloud** | `CEREBRAS_API_KEY` | 1. Visit [Cerebras Cloud](https://cloud.cerebras.ai/)<br>2. Sign up and navigate to **API Keys**<br>3. Generate key and copy into `CEREBRAS_API_KEY` |
| **Ollama (Local)** | `OLLAMA_BASE_URL` | 1. Install Ollama from [ollama.com](https://ollama.com)<br>2. Run `ollama run llama3.2` or `ollama run mistral`<br>3. Set `OLLAMA_BASE_URL=http://localhost:11434/v1` |

---

### E. Search Provider Credentials

| Variable | Provider | Instructions |
| :--- | :--- | :--- |
| `SEARCH_PROVIDER` | Choice: `tavily` or `brave` | Default: `tavily`. |
| `TAVILY_API_KEY` | **Tavily Search** | 1. Sign up at [https://tavily.com](https://tavily.com)<br>2. Copy key starting with `tvly-...` |
| `BRAVE_SEARCH_API_KEY` | **Brave Search** | Optional alternative to Tavily. Sign up at [https://brave.com/search/api/](https://brave.com/search/api/) |

---

### F. Budget Guard Limits (Per Run)

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `MAX_RUN_TOKENS` | `100000` | Hard cap on total tokens accumulated across all 4 agents. Prevents runaway loops. |
| `MAX_RUN_COST_USD` | `1.50` | Hard cap on financial cost per generation. Enforced pre-call before every LLM request. |

---

## 3. Verifying Your Configuration

Run the test suite to verify connectivity and multi-platform client creation:

```bash
# 1. Run LLM client and unit tests
pnpm --filter @citewriter/core run test src/llm/llm.test.ts

# 2. Run full monorepo test suite
pnpm test

# 3. Run interactive CLI test with your configured models
pnpm --filter @citewriter/core run cli
```
