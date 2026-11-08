# Demo data

**Everything here is synthetic.** Demo Contractor Ltd, the Kestrel Yard Depot Extension project and its documents are fictional, and so are Northbridge University (inherited from CourseFlow), its courses, staff, students, datasets, dates and documents. No text comes from any real organisation, project, institution, course or person. Any resemblance to a real one is accidental.

## Construction demo (`construction/`)

This is the demo the Construction Document Assistant runs.

| Path | Contents |
|---|---|
| `manifest.yaml` | Organisation *Demo Contractor Ltd (fictional)*, project `KYD001` *Kestrel Yard Depot Extension (fictional)*, its three documents and each revision's file and import time (`demo-manifest/v1`) |
| `documents/IP-01_Inspection_Procedure_RevA.pdf` | Inspection Procedure Rev A: 48 hours' notice of each inspection |
| `documents/IP-01_Inspection_Procedure_RevB.pdf` | Rev B: states that it supersedes Revision A; 72 hours' notice |
| `documents/SSR-01_Site_Safety_Rules.pdf` | Site safety rules: helmets and safety footwear, plus related rules |
| `documents/CT-01_Commercial_Terms.pdf` | A fictional payment schedule |

Every page carries the label *SYNTHETIC DEMO DOCUMENT – fictional project, not for construction use*. The PDFs are **generated** from `backend/app/demo/construction_content.py` by the same renderer as the Northbridge documents (`uv run python -m app.demo.generate`; `--check` verifies the committed bytes).

The extraction answers are **authored**, not model output. They are written in the same file, quote the documents exactly and are recorded under the model name `fixture:authored-construction/v1`. `backend/app/demo/construction.py` replays them through the real extraction gate. No embeddings are computed or committed for these documents. Rev A is imported initially; Rev B arrives through the local demo operation *Load next revision (demo)* (`POST /api/v1/demo/sync`).

## Northbridge University (`northbridge/`, inherited)

This is kept from CourseFlow because the inherited tests and evaluation code use it. The construction demo does not load it.

| Path | Contents |
|---|---|
| `manifest.yaml` | Institution, courses, resources, each version's file and publication time, the intended active version, and which demo user sees which course (`demo-manifest/v1`) |
| `courses/aml7001/` | AML7001 Applied Machine Learning |
| `courses/msd7000/` | MSD7000 MSc Dissertation |
| `supplement.yaml` | Two further courses for a fuller demo workspace (`demo-supplement/v1`); not part of the evaluation corpus |
| `courses/aif7002/` | AIF7002 AI Foundations in Practice (supplement) |
| `courses/dvs7003/` | DVS7003 Data Visualisation (supplement) |

The documents (PDF, DOCX, PPTX and HTML) are **generated**, never edited by hand. Their text lives in `backend/app/demo/northbridge_content.py` (and `supplement_content.py` for the supplement), and the renderer pins all metadata, so the same content always produces the same bytes:

```bash
cd backend
uv run python -m app.demo.generate          # rewrite courses/
uv run python -m app.demo.generate --check  # verify the committed files byte for byte
```

The material deliberately contains what CourseFlow has to handle:

- deadlines and weightings;
- assessment requirements;
- a hidden obligation (a supervisor review that must come before the Project Specification);
- a prerequisite (ethics approval before data collection);
- a deadline in the module handbook that conflicts with the coursework brief;
- an irrelevant lecture;
- an ambiguous statement;
- a prompt-injection sentence.

That sentence is course text only and must never be followed as an instruction.

Two resources change after the initial import, and each keeps its identity as the same resource with a new version:

- the AML7001 announcements page moves the Coursework 1 deadline (v2);
- the dissertation handbook changes the supervisor-review lead time (v2).

## The supplement

AIF7002 and DVS7003 make the demo workspace look like a real student's term: two assessments each, with weightings, deadlines between 16 and 26 November 2026, numbered requirements and the lectures and workshops that teach them. They deliberately hold no conflict, hidden obligation or change; those stay in the two main courses.

They are kept apart from the evaluation corpus: `manifest.yaml`, the golden labels and their snapshots never include them, and `DemoConnector` reads `supplement.yaml` only when asked to (the demo does; evaluation runs do not). They have no golden labels. Their extraction and mapping answers are **authored**, not model output (`backend/app/demo/supplement.py`): written from the briefs, quoting the material exactly, and passed through the same evidence gates as recorded model output. Calls answered this way are recorded under the model name `fixture:authored-supplement/v1`. Their document and mapping-query vectors are a separate committed snapshot pair (`evals/snapshots/northbridge/supplement-v2/`), pinned to the supplement's own hash.

`backend/app/connectors/demo.py` (`DemoConnector`) serves this institution through the same `LMSConnector` interface a real LMS connector will implement.

The documents are deliberately not phrased to make extraction easy. Evaluation labels are kept separately, under `evals/datasets/`.

## Seeding

One command imports both courses through `DemoConnector` and indexes them, inside the API container (which owns the raw-source store):

```bash
docker compose run --rm api python -m app.demo.seed --reset                 # initial state
docker compose run --rm api python -m app.demo.seed --state final           # apply the v2 changes
```

`--reset` removes the Northbridge institution and everything it owns, and nothing else. Indexing replays the committed embedding snapshot (`evals/snapshots/northbridge/v1/`), so seeding needs no API key, makes no network call and costs nothing. The snapshot is pinned to the frozen golden labels, whose hash covers these documents: if any document changes, seeding refuses the snapshot rather than mixing vectors.

In the final state only the two changed versions are new indexing work. The snapshot holds document vectors only, so lexical search works over a replayed seed; vector and hybrid search need a live query embedding.
