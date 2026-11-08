# Construction Document Assistant

**A local prototype that turns construction project documents into source-grounded requirements, searchable passages and cited answers, and keeps track of what changes when a document is reissued.**

> **Demo GIF:** *placeholder.* Record the walkthrough below, save it as `docs/assets/construction-demo.gif`, and replace this note with `![Demo walkthrough](docs/assets/construction-demo.gif)`.

## The problem

On a construction project, obligations are spread across procedures, safety rules and commercial terms, and those documents are reissued. A site team has to know which revision is in force, what it requires, who is responsible and by when. When a procedure moves from 48 to 72 hours' notice, acting on the superseded revision is a real error. Not everyone should see everything either: site staff need inspection and safety rules, but not commercial terms.

This prototype explores one answer to that problem. Every requirement and every answer points to the exact sentence, page and revision it came from. Superseded revisions are kept as history but excluded from current answers. The server decides what each role may read.

## What is implemented

| Capability | What it does |
|---|---|
| Requirement register | Requirement text, plus responsible role and deadline or notice period **only when the sentence states them** (otherwise "Not stated"), with the source quote, page and revision |
| Evidence viewer | The exact stored excerpt with its document, revision, page and verification status |
| Revision tracking | A reissued document is imported as a new revision of the same document. Its own supersession statement ("This revision supersedes Revision A") is found and quoted. Old requirements are kept as superseded history, and changed requirements are shown old against new |
| Document search | Source passages with file, page and revision; current revisions by default, history on request. **Lexical** (PostgreSQL full-text, offline) or **hybrid** (lexical fused with vector search over live embeddings) |
| Ask project documents | A live model answers using real tool calling (`search_documents`). Retrieval is scoped by the backend to the signed-in role, and the answer cites document, page and revision |
| Demo roles | Two fixed demo identities with different document permissions, enforced by the API |
| Live analysis (optional) | One model call over a document's current revision, shown separately and not saved |
| Logging | JSON request and chat logs (durations, tool calls, token counts); questions, passages, answers and credentials are not logged |

## Technology stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, Pydantic, async SQLAlchemy 2 (asyncpg), Alembic |
| Database | PostgreSQL 17 with pgvector 0.8 (`pgvector/pgvector:0.8.6-pg17`): relational data, full-text search, vector search |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| Models | Nebius Token Factory (OpenAI-compatible API) through the `openai` SDK: `nvidia/Nemotron-3_5-Lightning` for chat with tool calling, `Qwen/Qwen3-Embedding-8B` (4096 dimensions) for embeddings |
| Runtime | Docker Compose (database, migrations, API, seed, web) |
| Tests | pytest, Ruff, ESLint, TypeScript checks, Playwright |

## Architecture

```text
 Next.js UI ──HTTP + demo bearer token──▶ FastAPI API ──────────▶ PostgreSQL + pgvector
 (projects, register, search,             │  identity → readable document types       (documents, revisions, spans,
  ask, revisions)                         │  import → extraction gate → register       chunks, embeddings, requirements,
                                          │  search: lexical | lexical + vector (RRF)  workflow runs, model calls)
                                          │  chat: bounded tool loop (≤ 3 searches)
                                          └──────────▶ Nebius Token Factory (live only: embeddings, chat)
```

A modular monolith, inherited from CourseFlow:

- **The model proposes; deterministic code decides.** Evidence quotes must resolve to stored source spans. Roles, notice periods and dates must appear in the quoted sentence. Supersession and requirement changes are computed by versioned rules.
- **Revision-aware retrieval.** Each PDF page becomes a span and a chunk that keeps its project, document, revision and page. A revision is out of force only when a later revision of the same document says it supersedes it.
- **Bounded, scoped chat.** The model gets one tool. The backend fixes the project and the role's document types for every search and ignores anything else the model sends. Passages are returned as JSON marked as untrusted data. The first turn must search. There are at most 3 searches, after which the model must answer. Citations to sources that were never retrieved are removed and reported.
- **Traceability.** Imports and extractions run as recorded `WorkflowRun`s. Every live chat turn and every embedding call (indexing and search queries) is recorded as a model call with tokens, latency and outcome.

Key code:

| File | What it does |
|---|---|
| `backend/app/demo/construction.py`, `construction_content.py` | The synthetic documents, the construction demo and its authored fixture answers |
| `backend/app/extraction/obligations.py` | The extraction gate: modality, dates, role and notice-period checks |
| `backend/app/reasoning/revisions.py`, `backend/app/db/changes.py` | Supersession statements, revision labels, and what a new revision changed |
| `backend/app/retrieval/chunk_index.py`, `indexing.py`, `project_search.py` | Chunking, live embedding, lexical and hybrid project search |
| `backend/app/orchestration/project_chat.py`, `backend/app/api/v1/ask.py` | The tool-calling chat loop and its endpoint |
| `backend/app/api/demo_auth.py` | Demo identities, tokens and permission checks |
| `backend/app/ai/nebius.py`, `nebius_embeddings.py` | Provider clients for chat and embeddings |

## Run it with Docker

Prerequisite: Docker with Compose v2. From the repository root:

```bash
docker compose -f infra/demo/compose.yml up -d --build --wait
```

Open **http://localhost:3100**. The API is at http://localhost:8100 (`/api/v1/health`). The first build needs network access. Without credentials, the demo runs fully offline with no model calls. The live features (hybrid search, Ask, live analysis) are disabled, and the interface shows the reason.

Stop the stack (the data volume is kept):

```bash
docker compose -f infra/demo/compose.yml down
```

### Local credentials (for the live features)

Credentials live only in the git-ignored root `.env`. Never commit it.

```bash
cp .env.example .env    # then set NEBIUS_API_KEY in .env
```

| Variable | Purpose | In `.env.example` |
|---|---|---|
| `NEBIUS_API_KEY` | Nebius Token Factory API key | **empty: fill this in** |
| `NEBIUS_BASE_URL` | `https://api.tokenfactory.nebius.com/v1/` | filled in |
| `MODEL_FAST`, `MODEL_STRONG` | Chat and live-analysis models | filled in |
| `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `EMBEDDING_SPACE_VERSION` | Embedding model and space (`Qwen/Qwen3-Embedding-8B`, 4096, `v1`) | filled in |

Start with the env file, then embed the loaded revisions once. Embedding makes paid calls: four small calls for the demo corpus.

```bash
docker compose --env-file .env -f infra/demo/compose.yml up -d --build --wait
docker compose -f infra/demo/compose.yml exec api python -m app.demo.construction_search index-live --yes
docker compose -f infra/demo/compose.yml exec api python -m app.demo.construction_search status   # every revision: "embedded": true
```

Hybrid search needs every readable in-force revision to be embedded. Load Rev B (**Load next revision (demo)**) before running `index-live`. Run `index-live` again after **Reset local demo**, because a reset rebuilds the project's data. Each hybrid search or chat search then makes one paid query-embedding call. Each chat question makes two or more chat calls.

## Demo roles and permissions

Sign-in offers two fixed identities, with no passwords.

| Identity | May read |
|---|---|
| Site Engineer | IP-01 Inspection Procedure (all revisions), SSR-01 Site Safety Rules |
| Commercial Manager | The above, plus CT-01 Commercial Terms |

The API checks the identity on every content endpoint:

- document lists, and documents themselves (403 for a forbidden document);
- requirements and their evidence;
- revision changes;
- search and its index status;
- every search the chat makes.

Inherited endpoints that are not filtered per document require full access. Health, capabilities and the identity list are public.

**This is demo authentication, not security.** Anyone who can reach the API can sign in as either identity. Tokens are signed with a key that is random per API process, so restarting the API signs everyone out. Keep the stack local.

## Two-minute walkthrough

The project is **KYD001 Kestrel Yard Depot Extension (fictional)**, with four synthetic PDFs of three or four pages each: IP-01 Rev A (48 hours' notice), IP-01 Rev B (supersedes Rev A, 72 hours), SSR-01 and CT-01 (payment schedule and retention). Besides the requirement sentences, each carries descriptive context: document control, revision or issue history, background, scope, definitions, informational tables and labelled illustrative examples. Every page carries the synthetic-document label, and none of it claims compliance with any real standard. The live steps assume the credentials and indexing above.

1. **Current-revision search (about 30 seconds).** Sign in as **Commercial Manager**, press **Load next revision (demo)**, and open the project.
   - In **Search documents**, choose **Hybrid (live embeddings)** and search *How much notice before an inspection?* IP-01 Rev B ranks first and Rev A is not returned; the panel reports one superseded revision excluded. Other documents may follow as weaker vector matches.
   - Tick **Include superseded revisions (history)**: Rev A appears, labelled "Superseded by Revision B" with the supersession quote.
2. **Cited chat (about 30 seconds).** In **Ask project documents**, ask *How much notice must be given before a hold point inspection under the current inspection procedure?*
   - The answer shows the `search_documents` call the model made and the retrieval mode (hybrid).
   - Its source line names IP-01 Rev B and the pages of the retrieved passage; the 72 hours' notice sentence is on page 3.
3. **Restricted commercial information (about 30 seconds).** Press **Switch** in the sidebar and sign in as **Site Engineer**.
   - Commercial Terms disappears from the document list.
   - Searching *retention percentage on payment applications* returns no commercial passage.
   - Asking *What retention percentage applies to payment applications on this project?* yields an answer that the available documents do not contain the information.
4. **Revision history (about 30 seconds).** Open **Revisions**: Rev B supersedes Rev A, with Rev B's own statement quoted, and the notice requirement changed from 48 to 72 hours. Back on the project, Rev A's requirement is still listed under **Superseded requirements (history)**, with its original evidence.

Pages never reset the demo. Only **Reset local demo**, which asks for confirmation and rebuilds the project at Rev A, and **Load next revision (demo)** change data.

## What is authored, and what was verified live

The project mixes recorded fixtures with live model features. They are kept apart in the code, in the interface and here.

### Authored offline fixtures (not model output)

The **requirement register** is built by replaying **authored fixture answers**. These are answers written by hand for the synthetic documents and recorded under the model name `fixture:authored-construction/v1`. They pass through the same extraction gate and evidence checks as model output would. They are **not model output and not an evaluation of a model**, and the interface labels them "Offline replay · authored fixtures, not live AI". They show that the pipeline, gate and revision logic behave correctly on known answers. No construction extraction has been evaluated against a live model.

**The register is curated.** It holds the 11 requirement sentences the synthetic documents were written around. The surrounding pages were deliberately written as descriptive context, with no added duties, deadlines, prohibitions, acceptance criteria or payment conditions, so the register stays complete without any top-N limit or filtering of valid requirements. It is a curated synthetic answer set, not a claim about what an extractor would find in real documents.

### Verified offline

- Lexical search: tests, a small labelled benchmark (below) and the running demo.
- Role scoping of documents, evidence, changes and search: tests and the running demo.
- The chat loop's scoping, ignored arguments, citation checks, tool-call limit and provider-failure handling: tests with a scripted tool-calling test double.

### Verified live

These were single, minimal checks against Nebius Token Factory on the running local demo, on 8 November 2026, with the earlier one-page versions of the PDFs (page numbers below refer to those). They are not a benchmark.

| Check | Result |
|---|---|
| Live embeddings | All four revisions embedded with `Qwen/Qwen3-Embedding-8B` (4 calls, 615 tokens). The index status then reported every revision embedded |
| Hybrid search (Commercial Manager) | Mode `hybrid` with a live query embedding. Top hit was IP-01 Rev B, ranked first by both the lexical and the vector ranking; Rev A was excluded as superseded |
| Cited chat (Commercial Manager) | `search_documents` was called and retrieval was hybrid. The answer cited only S1, IP-01 Rev B page 1 (72 hours). No citations were removed, and both model turns were recorded |
| Site Engineer chat | The model called the tool with hybrid retrieval. No Commercial Terms passage was retrieved or cited, and the answer stated that the documents did not contain the information |
| Site Engineer access | Commercial Terms was absent from the document list and the index status. Opening it directly and live-analysing it both returned 403. A hybrid search across all revisions returned no contract passage |
| Logs | The API log contained no API key, no `Bearer` token and no question text |

**Order of the checks.** The first Commercial Manager chat exposed a problem: the model announced a search in plain text instead of calling the tool, so the answer came back uncited. The chat loop was then changed so that the first turn requires a tool call (`tool_choice="required"`), and the Commercial Manager chat above was run after that fix. **The Site Engineer chat ran before the fix**; the model happened to call the tool in that run. **The Site Engineer access checks were rerun after the fix.**

These checks cover document-type scoping for the two demo roles. **They are not a security review.**

### Not verified live

- **Live analysis** ("Analyse live" on a document page): the endpoint reports itself available with credentials, but no live analysis call was made.
- **The retrieval benchmark in hybrid mode:** it was not run, to keep paid calls minimal.

## Search details

The search API is `POST /api/v1/courses/{id}/search`, with index status at `GET /api/v1/courses/{id}/search/status`. The search panel returns passages, not answers; the Ask panel is the only part that generates text.

- **Lexical** uses PostgreSQL full-text ranking (`pg-fts-english/v2`) over the stored chunks, offline.
- **Hybrid** fuses that ranking with vector search using reciprocal rank fusion (`rrf-k60-depth50/v2`). The query is embedded live.

Hybrid search is **refused, never downgraded**. It answers 503 without credentials and 409 if a revision being searched is not embedded. No authored or recorded embeddings stand in for live ones. The chat uses hybrid retrieval when it is available and lexical otherwise, and every answer reports which one it used.

**Supersession.** A revision is out of force only when another revision of the same document states that it supersedes it, naming the code the older revision states for itself (rule `revision-supersession/v1`). Upload order alone never supersedes anything, and an ambiguous statement excludes nothing.

**Retrieval benchmark.** `evals/datasets/construction-retrieval/v1/cases.yaml` holds 14 hand-labelled queries over the four documents, each labelled with the page that holds the expected passage. Lexical only: Hit@1 12/14, Hit@3 14/14, MRR@10 0.929, and Rev A returned in 0 of 5 current-only cases ([report](evals/reports/construction-retrieval-v1-lexical.md)). The span-pack chunker joins neighbouring short pages, so a retrieved chunk can cover two or three pages; each citation keeps the page of its own quote. **With four short synthetic documents, these numbers are a regression check of the pipeline, not a measure of retrieval quality.**

## Development and checks

See the [development guide](docs/development.md), which is inherited from CourseFlow. Backend, with the test database available:

```bash
cd backend
uv run pytest tests/test_construction_demo.py tests/test_construction_search.py tests/test_demo_permissions_and_chat.py
uv run ruff check . && uv run ruff format --check .
uv run python -m app.demo.generate --check   # committed demo PDFs match their source text
```

From `frontend/`: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run build`. `npx playwright test` drives the golden path against a running demo and resets the local demo first.

`tests/test_demo_replay.py` uses `git ls-files` to check that the demo recordings are committed. Outside a git checkout that check is skipped, with the reason given.

## Limitations

- **Small synthetic corpus.** One fictional project with four documents of three or four pages. Nothing here was tested on real construction documents, scanned drawings or long specifications.
- **No general retrieval-quality claim.** The benchmark is 14 queries over four short documents, and the live checks were single queries. Chunks pack whole short pages, and lexical search misses paraphrases.
- **Authored fixtures, not model extraction.** The requirement register comes from hand-written answers. There is no labelled construction extraction dataset and no measured extraction accuracy.
- **Demo authentication only.** Two fixed identities, no passwords, accounts or sessions beyond a per-process signing key. Permissions are by document type only. The checks above are not a security validation.
- **No production deployment.** The project runs only as a local Docker Compose stack, with no hosting, TLS, secret management, monitoring or multi-user hardening.
- **Single-question chat.** There is no conversation memory, and the tool-calling model is one specific provider model.
- **Narrow field capture.** The role check is lexical: a role named in the sentence is kept even if it is the recipient rather than the responsible party. Only explicit calendar dates and notice-style periods are captured as deadlines.
- **Revision labels are derived** from the order in which revisions were stored. Supersession is decided only from what the documents state.
- **No upload UI, OCR or external integrations.** Text-based PDFs are imported by the backend. The interface is desktop-first.

## Acknowledgement: built on CourseFlow

This project builds on **CourseFlow**, an earlier course-document prototype, and reuses its architecture, ingestion, evidence-gate, workflow and retrieval code. Some internal names are inherited: a *course* is a project, a *resource* is a document, a *version* is a revision, and the database is still called `courseflow`. The Northbridge University course data (`demo_data/northbridge/`), its evaluation datasets and reports (`evals/`), and CourseFlow's architecture notes and decision records under `docs/` are kept because tests and evaluation code depend on them. **None of their results apply to construction documents.**

## License

[Mozilla Public License 2.0](LICENSE).
