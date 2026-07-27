# ADR-005: Material Intelligence Layer — Search, Suggestions & Similarity

**Status:** Accepted
**Date:** 2026-07-26
**Phase:** Material Phase 2–3 (validated Phase 5)

---

## Context

The canonical `materials` table will contain hundreds to thousands of records. Customers and AI agents need to find the right material quickly — by natural language query (including Indonesian terms), by visual similarity, or by project context. A simple SQL `ILIKE` search is insufficient for:

- Indonesian language aliases (`marmer` should find `marble`)
- Fuzzy matching (`eng wood` → `Engineered Wood`)
- Contextual suggestions based on what materials are already on a project
- Similarity discovery (find materials like this one)

---

## Decision

Implement a **Material Intelligence layer** as a set of dedicated API endpoints separate from the core CRUD routes:

| Endpoint | Purpose |
|---|---|
| `POST /material-library/search` | Full-text + alias search with Indonesian language support |
| `POST /material-library/suggestions` | Context-aware suggestions based on current project materials |
| `GET /material-library/:id/similar` | Find materials similar to a given record |
| `GET /material-library/analytics` | Usage analytics (admin only) |

The layer is implemented in `material-intelligence.ts` and `materialLibraryService.ts`.

**Search approach:**
- Primary: PostgreSQL full-text search with `tsvector` over `name`, `brand`, `search_keywords`
- Secondary: Indonesian alias table mapping local terms to canonical English material names
- Tertiary: trigram similarity for fuzzy matching on material code and name

**Feature flag:**
- Phase 3 advanced intelligence routes are gated behind `DESIGN_AI_MULTI_AGENT_ENABLED` flag (default `false` in production)
- Core search and suggestions are always enabled

---

## Alternatives Considered

### External Vector Database (Pinecone, Weaviate)
Use a dedicated vector DB for semantic search. Rejected for Phase 5 — adds a new service dependency; PostgreSQL with `pg_trgm` and `tsvector` is sufficient at current material catalog size (<10,000 records); revisit if catalog exceeds 100k records.

### OpenAI Embeddings + pgvector
Generate embeddings for each material and store in `pgvector`. Rejected for Phase 5 — every new material requires an embedding API call (cost + latency); Supabase pgvector extension availability not confirmed for this project; deferred to future phase.

### Client-Side Search (Fuse.js)
Load all materials to the client and search in-browser. Rejected — catalog size makes full download impractical; exposes full catalog to all users including unauthenticated ones.

---

## Consequences

**Positive:**
- Indonesian alias resolution works natively without external dependencies
- Warm search latency < 1 ms (cached tsvector indexes)
- Cold search latency < 200 ms (verified in validation report)
- Feature-flag gating allows safe incremental exposure in production

**Negative:**
- PostgreSQL full-text search is less semantically aware than vector search
- Alias table requires manual maintenance as new Indonesian terms emerge
- Analytics endpoint is admin-only — customer-facing usage data not surfaced

**Phase 6 note:**
- Material recommendation engine (uses suggestions endpoint) can be enabled by setting `DESIGN_AI_MULTI_AGENT_ENABLED=true` in production — no code change required
