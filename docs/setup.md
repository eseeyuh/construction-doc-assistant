# Setup guide

How to run the Construction Document Assistant demo, enable its live features, and check changes. The short version is in the [README](../README.md#quick-start).

## Offline demo

Requires Docker with Compose v2. From the repository root:

```bash
docker compose -f infra/demo/compose.yml up -d --build --wait
```

The Compose project `construction-doc-assistant-demo` starts, in order: `db` (PostgreSQL 17 with pgvector), `migrate` (Alembic), `api` (FastAPI, `APP_ENV=demo`), `seed` (loads the fictional project at Rev A only if it is not loaded yet) and `web` (Next.js).

| Service | Address |
|---|---|
| Web app | http://localhost:3100 |
| API | http://localhost:8100 (health: `/api/v1/health`) |
| Database | not published; only the API reaches it |

Ports bind to `127.0.0.1` by default. `BIND_ADDRESS`, `WEB_PORT`, `API_PORT`, `WEB_ORIGIN` and `API_PUBLIC_URL` override the defaults; `API_PUBLIC_URL` is compiled into the web image, so changing it needs `--build`.

Stop the stack without deleting data:

```bash
docker compose -f infra/demo/compose.yml down
```

Do not add `-v` unless you intend to delete the database and raw-file volumes. Restarting never resets the demo: the `seed` service keeps an existing project, including a loaded Rev B.

## Live configuration

Credentials live only in the git-ignored root `.env`. Never commit it.

```bash
cp .env.example .env    # PowerShell: Copy-Item .env.example .env
```

| Variable | Purpose | In `.env.example` |
|---|---|---|
| `NEBIUS_API_KEY` | Nebius Token Factory API key | empty: fill this in |
| `NEBIUS_BASE_URL` | `https://api.tokenfactory.nebius.com/v1/` | filled in |
| `MODEL_FAST`, `MODEL_STRONG` | Provider models; both must be set for live chat and live analysis | filled in |
| `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `EMBEDDING_SPACE_VERSION` | Embedding model and space (`Qwen/Qwen3-Embedding-8B`, 4096, `v1`) | filled in |

The chat itself uses the pinned model `nvidia/Nemotron-3_5-Lightning`. Compose passes these variables to the `api` container only.

Start with the env file, load Rev B, then embed the stored revisions:

```bash
docker compose --env-file .env -f infra/demo/compose.yml up -d --build --wait
# In the app: sign in, then press "Load next revision (demo)".
docker compose --env-file .env -f infra/demo/compose.yml exec api python -m app.demo.construction_search index-live --yes
docker compose --env-file .env -f infra/demo/compose.yml exec api python -m app.demo.construction_search status
```

`status` should report `"embedded": true` for every revision. Indexing, every hybrid search (one query embedding) and every chat question (two or more chat calls, plus query embeddings) make paid provider calls.

## Demo roles and permissions

Sign-in offers two fixed identities, with no passwords.

| Identity | May read |
|---|---|
| Site Engineer | IP-01 Inspection Procedure (all revisions), SSR-01 Site Safety Rules |
| Commercial Manager | The above, plus CT-01 Commercial Terms |

The API checks the identity on every content endpoint: document lists and documents (403 for a forbidden document), revision files, requirements and their evidence, revision changes, search and its index status, and every search the chat makes. Inherited endpoints that are not filtered per document require full access. Health, capabilities and the identity list are public.

This is demo authentication, not security. Anyone who can reach the API can sign in as either identity, and tokens are signed with a key generated per API process. Keep the stack local.

## Demo operations

Pages never change data. Only two controls do:

- **Reset local demo** asks for confirmation, then rebuilds the project's data at Rev A. Run `index-live` again afterwards (after loading Rev B) to restore hybrid search.
- **Load next revision (demo)** imports Rev B through the normal revision path.

## Checks

The development guide inherited from CourseFlow covers the host toolchain: [docs/development.md](development.md). Backend, with the test database available:

```bash
cd backend
uv run pytest tests/test_construction_demo.py tests/test_construction_search.py tests/test_demo_permissions_and_chat.py
uv run ruff check . && uv run ruff format --check .
uv run python -m app.demo.generate --check   # committed demo files match their source text
```

From `frontend/`: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run build`. `npx playwright test` drives the golden path against a running demo and **resets the local demo first**.

`tests/test_demo_replay.py` uses `git ls-files` to check that the demo recordings are committed; outside a git checkout that check is skipped with a reason.

The offline lexical retrieval benchmark runs against a disposable `courseflow_eval` database and makes no model calls; see [Design and verification](design-and-verification.md#retrieval-benchmark).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Hybrid search or Ask reports that live features are not configured (503) | The API was started without credentials. Fill in `.env` and restart with `--env-file .env`. |
| Hybrid search answers 409 | A revision being searched has no embeddings, typically after loading Rev B or resetting. Run `index-live` again. |
| Everyone is signed out | The API restarted; its token signing key is per process. Sign in again. |
| The web app cannot reach the API | Check that the address you open matches `WEB_ORIGIN` (CORS), and rebuild `web` after changing `API_PUBLIC_URL`. |
