# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""FastAPI application factory.

Run with: ``uvicorn app.main:create_app --factory``
"""

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.engine import make_url

from app import __version__
from app.api import health
from app.api.v1.router import api_router
from app.core.config import Settings, get_settings
from app.core.logging import configure_logging
from app.db.session import create_db_engine, create_session_factory

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Process-wide resources: created once before serving, released on shutdown."""
    settings: Settings = app.state.settings
    engine = create_db_engine(settings)
    app.state.engine = engine
    app.state.session_factory = create_session_factory(engine)

    database = make_url(settings.database_url.get_secret_value())
    logger.info(
        "app.startup",
        extra={
            "version": __version__,
            "app_env": settings.app_env,
            "database": database.render_as_string(hide_password=True),
        },
    )
    try:
        yield
    finally:
        await engine.dispose()
        logger.info("app.shutdown")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(title="CourseFlow API", version=__version__, lifespan=lifespan)
    app.state.settings = settings
    # CORS lets the listed browser origins (the web frontend) READ responses.
    # It is not authentication: non-browser clients ignore it entirely.
    # GET for reads; POST and PUT for the demo operations (start the demo
    # workflow, set a study state), JSON bodies only. The demo sign-in token
    # travels in the Authorization header; no cookies/credentials, no other
    # method, only the listed origins.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Content-Type", "Authorization"],
        allow_credentials=False,
    )
    app.middleware("http")(_log_request)
    app.include_router(health.router)
    app.include_router(api_router)
    return app


async def _log_request(request: Request, call_next) -> Response:  # type: ignore[no-untyped-def]
    """One line per API request: method, route template, status, duration.
    Never the query string, headers or body (queries and tokens live there)."""
    started = time.perf_counter()
    status = 500
    try:
        response: Response = await call_next(request)
        status = response.status_code
        return response
    finally:
        route = request.scope.get("route")
        logger.info(
            "http.request",
            extra={
                "method": request.method,
                "route": getattr(route, "path", None) or "unmatched",
                "status": status,
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
            },
        )
