# Design and verification

How the Construction Document Assistant keeps answers tied to their sources, and what has actually been checked. Setup is in the [setup guide](setup.md); the overview is in the [README](../README.md).

## Design

The application is a modular monolith inherited from CourseFlow. A few rules hold throughout:

- **The model proposes; deterministic code decides.** Evidence quotes must resolve to stored source spans. Roles, notice periods and dates must appear in the quoted sentence. Supersession and requirement changes are computed by versioned rules.
- **Revision-aware retrieval.** Each PDF page becomes a span that keeps its project, document, revision and page. The `span-pack/v1` chunker packs neighbouring short pages into one chunk, so a chunk can cover two or three pages, but each citation keeps the page of its own quote.
- **Bounded, scoped chat.** The model gets one tool, `search_documents`. The backend fixes the project and the identity's readable document types for every call and ignores, then reports, any other arguments. Passages are returned as JSON marked as untrusted data. The first turn must search (`tool_choice="required"`); after at most three searches the model must answer. Citations to sources that were never retrieved are removed and reported, and an answer that cites nothing is marked ungrounded.
- **Traceability.** Imports and extractions run as recorded workflow runs. Every live chat turn and embedding call is recorded with tokens, latency and outcome. Logs hold counts and durations, never questions, passages, answers or credentials.

### Search

The search API is `POST /api/v1/courses/{id}/search`, with index status at `GET /api/v1/courses/{id}/search/status`. The search panel returns passages, never generated text.

- **Lexical** uses PostgreSQL full-text ranking (`pg-fts-english/v2`) over stored chunks, offline.
- **Hybrid** fuses that ranking with pgvector similarity using reciprocal rank fusion (`rrf-k60-depth50/v2`). The query is embedded live.

Hybrid search is refused, never silently downgraded: it answers 503 without credentials and 409 if a searched revision is not embedded. No authored or recorded embeddings stand in for live ones. The chat uses hybrid retrieval when available and lexical otherwise, and reports which it used.

### Supersession

A revision is out of force only when another revision of the same document states that it supersedes it, naming the code the older revision states for itself (`revision-supersession/v1`). Upload order alone never supersedes anything, and an ambiguous statement excludes nothing. In the demo, IP-01 Rev B states "This revision supersedes Revision A." on its first page.

### Key code

| Path | Responsibility |
|---|---|
| `backend/app/demo/construction.py`, `construction_content.py` | Synthetic documents, the construction demo and its authored fixture answers |
| `backend/app/extraction/obligations.py` | Extraction gate: modality, dates, role and notice-period checks |
| `backend/app/reasoning/revisions.py`, `backend/app/db/changes.py` | Supersession statements, revision labels and requirement changes |
| `backend/app/retrieval/project_search.py`, `fusion.py`, `rankers.py` | Lexical, vector and fused project search |
| `backend/app/orchestration/project_chat.py`, `backend/app/api/v1/ask.py` | The tool-calling chat loop and its endpoint |
| `backend/app/api/demo_auth.py` | Demo identities, tokens and permission checks |
| `backend/app/api/v1/documents.py` | Documents, revisions and authorised revision file downloads |
| `frontend/components/ProjectSearch.tsx`, `PdfPreview.tsx` | Search results as a PDF.js preview with highlighting |

## Authored fixtures versus live AI

The **requirement register** is built by replaying **authored fixture answers**: answers written by hand for the synthetic documents and recorded under the model name `fixture:authored-construction/v1`. They pass through the same extraction gate and evidence checks as model output would, and the interface labels them "Offline replay · authored fixtures, not live AI". They show that the pipeline, gate and revision logic behave correctly on known answers. No construction extraction has been evaluated against a live model.

The register is **curated**. It holds the 11 requirement sentences the synthetic documents were written around. The surrounding pages are deliberately descriptive (document control, background, definitions, informational tables, labelled examples) and add no duties, deadlines, prohibitions, acceptance criteria or payment conditions, so the register stays complete without a top-N limit or filtering of valid requirements. It is not a claim about what an extractor would find in real documents.

Live models are used only for embeddings, hybrid search, the cited chat and the optional "Analyse live" document action.

## Verification record

### Verified offline

- Lexical search: tests, the labelled benchmark below and the running demo.
- Role scoping of documents, revision files, evidence, changes and search: tests and the running demo.
- The chat loop's scoping, ignored arguments, citation checks, tool-call limit and provider-failure handling: tests with a scripted tool-calling test double.

### Live checks on the original one-page PDFs (8 November 2026)

Single, minimal checks against Nebius Token Factory on the running local demo, made while each demo document was a single page. Page numbers refer to those earlier files. They are not a benchmark.

| Check | Result |
|---|---|
| Live embeddings | All four revisions embedded with `Qwen/Qwen3-Embedding-8B` (4 calls, 615 tokens); the index status then reported every revision embedded |
| Hybrid search (Commercial Manager) | Mode `hybrid` with a live query embedding. The top hit was IP-01 Rev B, ranked first by both the lexical and the vector ranking; Rev A was excluded as superseded |
| Cited chat (Commercial Manager) | `search_documents` was called with hybrid retrieval. The answer cited only S1, IP-01 Rev B page 1 (72 hours). No citations were removed, and both model turns were recorded |
| Site Engineer chat | The model called the tool with hybrid retrieval. No Commercial Terms passage was retrieved or cited, and the answer said the documents did not contain the information |
| Site Engineer access | Commercial Terms was absent from the document list and the index status. Opening it directly and live-analysing it both returned 403. A hybrid search across all revisions returned no contract passage |
| Logs | The API log contained no API key, no bearer token and no question text |

**Order of the checks.** The first Commercial Manager chat exposed a problem: the model announced a search in plain text instead of calling the tool, so the answer came back uncited. The chat loop was then changed so the first turn requires a tool call, and the Commercial Manager chat above ran after that fix. The Site Engineer chat ran before the fix (the model happened to call the tool). The Site Engineer access checks were rerun after the fix.

These checks cover document-type scoping for the two demo roles. They are not a security review.

### Checks on the enriched PDFs (8 November 2026, later)

The demo PDFs were then expanded to three or four pages each, keeping every requirement sentence verbatim. These checks were offline or lexical only:

- The focused backend tests (`test_construction_demo`, `test_construction_search`, `test_demo_permissions_and_chat`) passed, including requirement evidence on the correct pages (for example, the Rev A notice sentence on page 3).
- The lexical retrieval benchmark below was re-run on the new corpus.
- On the running demo, a lexical search for *safety helmets* opened SSR-01 at page 2 of 3, the page of the matching quote, with the query words highlighted.

The live hybrid and chat checks above have not been repeated on the enriched PDFs.

### Not verified live

- **Live analysis** ("Analyse live" on a document page): the endpoint reports itself available with credentials, but no live analysis call was made.
- **The retrieval benchmark in hybrid mode:** not run, to keep paid calls minimal.

## Retrieval benchmark

[`evals/datasets/construction-retrieval/v1/cases.yaml`](../evals/datasets/construction-retrieval/v1/cases.yaml) holds 14 hand-labelled queries over the four revisions, each labelled with the file, page and passage that should answer it. Five cases are invariants: the superseded Rev A must not appear in current-only results.

On the enriched corpus, lexical only: **Hit@1 12/14, Hit@3 14/14, MRR@10 0.929, and Rev A returned in 0 of 5 current-only cases** ([report](../evals/reports/construction-retrieval-v1-lexical.md)). On the earlier one-page corpus the same dataset scored Hit@1 12/14, Hit@3 13/14 and MRR@10 0.893.

With four short synthetic documents, these numbers are a regression check of the pipeline (revision filtering, citations, ranking plumbing), not a measure of retrieval quality.

## Detailed limitations

- **Small synthetic corpus.** Nothing was tested on real construction documents, scanned drawings or long specifications.
- **Authored fixtures, not model extraction.** There is no labelled construction extraction dataset and no measured extraction accuracy.
- **Narrow field capture.** The role check is lexical: a role named in the sentence is kept even if it is the recipient rather than the responsible party. Only explicit calendar dates and notice-style periods are captured as deadlines.
- **Revision labels are derived** from the order in which revisions were stored; supersession is decided only from what the documents state.
- **Single-question chat.** There is no conversation memory, and the tool-calling model is one specific provider model.
- **Demo authentication only.** Two fixed identities, no passwords or accounts, permissions by document type only.
- **No production deployment, upload UI, OCR or external integrations.** Text-based PDFs are imported by the backend, and the interface is desktop-first.
- **Inherited material.** The Northbridge University course data, its evaluation datasets and reports, and CourseFlow's architecture notes and decision records are kept because tests and evaluation code depend on them. None of their results apply to construction documents.
