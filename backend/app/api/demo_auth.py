# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""DEMO sign-in: two fixed identities chosen by the backend. Not real
authentication. There are no passwords or user accounts: anyone who can reach
the API can sign in as either identity. It exists to show that document
permissions are enforced on the server, in every endpoint that returns
document content (lists, documents, evidence, search, chat), never only by
hiding UI.

A sign-in returns a bearer token: an HMAC-signed identity and expiry. The
signing key is random per API process, so restarting the API signs everyone
out. The token names only an identity; what that identity may read is
decided here, on every request, from ``IDENTITIES``.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from app.api.deps import SettingsDep
from app.domain.enums import ResourceType

TOKEN_TTL_SECONDS = 8 * 60 * 60
AUTH_MODE = "demo"  # shown in every response that names an identity


@dataclass(frozen=True, slots=True)
class DemoIdentity:
    id: str
    name: str
    access: str  # what the identity may read, in words
    document_types: frozenset[ResourceType]

    @property
    def full_access(self) -> bool:
        """May read everything, including the inherited (non-construction)
        endpoints that are not filtered per document."""
        return self.document_types >= CONSTRUCTION_TYPES

    @property
    def type_scope(self) -> frozenset[ResourceType] | None:
        """The document types to filter by; None (no filter) with full access."""
        return None if self.full_access else self.document_types

    def can_read(self, resource_type: ResourceType) -> bool:
        return self.full_access or resource_type in self.document_types

    def can_read_all(self, resource_types: Iterable[ResourceType]) -> bool:
        if self.full_access:
            return True
        types = list(resource_types)
        return bool(types) and all(self.can_read(t) for t in types)


CONSTRUCTION_TYPES = frozenset(
    {ResourceType.PROCEDURE, ResourceType.SAFETY_RULES, ResourceType.CONTRACT}
)

IDENTITIES: dict[str, DemoIdentity] = {
    i.id: i
    for i in (
        DemoIdentity(
            id="site-engineer",
            name="Site Engineer",
            access="Inspection procedures and site safety rules",
            document_types=frozenset({ResourceType.PROCEDURE, ResourceType.SAFETY_RULES}),
        ),
        DemoIdentity(
            id="commercial-manager",
            name="Commercial Manager",
            access="Inspection procedures, site safety rules and commercial terms",
            document_types=CONSTRUCTION_TYPES,
        ),
    )
}


# --- tokens ----------------------------------------------------------------------------


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def signing_key(request: Request) -> bytes:
    state = request.app.state
    if getattr(state, "demo_auth_key", None) is None:
        state.demo_auth_key = secrets.token_bytes(32)
    return state.demo_auth_key


def issue_token(key: bytes, identity: DemoIdentity, now: float | None = None) -> tuple[str, int]:
    expires = int((now or time.time()) + TOKEN_TTL_SECONDS)
    payload = _b64(json.dumps({"sub": identity.id, "exp": expires}).encode())
    signature = _b64(hmac.new(key, payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{signature}", expires


def read_token(key: bytes, token: str, now: float | None = None) -> DemoIdentity | None:
    """The identity a valid, unexpired token names; None otherwise."""
    try:
        payload, signature = token.split(".")
        expected = _b64(hmac.new(key, payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return None
        claims = json.loads(_unb64(payload))
        if int(claims["exp"]) <= (now or time.time()):
            return None
        return IDENTITIES.get(claims["sub"])
    except (ValueError, KeyError, TypeError):
        return None


# --- dependencies ----------------------------------------------------------------------


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=401, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def get_viewer(
    request: Request,
    settings: SettingsDep,
    authorization: Annotated[str | None, Header()] = None,
) -> DemoIdentity:
    """The signed-in demo identity. Every content endpoint depends on it."""
    if settings.app_env == "production":
        raise HTTPException(status_code=503, detail="demo sign-in is not offered in production")
    if authorization is None or not authorization.startswith("Bearer "):
        raise _unauthorized("sign in first (demo sign-in)")
    identity = read_token(signing_key(request), authorization.removeprefix("Bearer ").strip())
    if identity is None:
        raise _unauthorized("the demo sign-in has expired or is invalid; sign in again")
    return identity


ViewerDep = Annotated[DemoIdentity, Depends(get_viewer)]


def require_full_access(viewer: ViewerDep) -> DemoIdentity:
    """For inherited endpoints whose content is not filtered per document."""
    if not viewer.full_access:
        raise HTTPException(status_code=403, detail=f"not permitted for {viewer.name}")
    return viewer


FullAccessDep = Annotated[DemoIdentity, Depends(require_full_access)]


def forbid_unless_readable(viewer: DemoIdentity, resource_type: ResourceType) -> None:
    if not viewer.can_read(resource_type):
        raise HTTPException(
            status_code=403, detail=f"{viewer.name} may not read this document (demo permissions)"
        )


# --- routes ----------------------------------------------------------------------------

router = APIRouter(prefix="/auth", tags=["demo auth"])


class IdentityRead(BaseModel):
    id: str
    name: str
    access: str
    document_types: list[ResourceType]
    auth_mode: Literal["demo"] = AUTH_MODE


def identity_read(identity: DemoIdentity) -> IdentityRead:
    return IdentityRead(
        id=identity.id,
        name=identity.name,
        access=identity.access,
        document_types=sorted(identity.document_types),
    )


class SignInBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    identity: str


class SignInRead(BaseModel):
    token: str
    expires_at: int  # Unix seconds
    identity: IdentityRead


@router.get("/identities")
async def list_identities(settings: SettingsDep) -> list[IdentityRead]:
    if settings.app_env == "production":
        raise HTTPException(status_code=404, detail="not found")
    return [identity_read(i) for i in IDENTITIES.values()]


@router.post("/demo-sign-in")
async def demo_sign_in(request: Request, settings: SettingsDep, body: SignInBody) -> SignInRead:
    if settings.app_env == "production":
        raise HTTPException(status_code=404, detail="not found")
    identity = IDENTITIES.get(body.identity)
    if identity is None:
        raise HTTPException(status_code=422, detail="unknown demo identity")
    token, expires = issue_token(signing_key(request), identity)
    return SignInRead(token=token, expires_at=expires, identity=identity_read(identity))


@router.get("/me")
async def me(viewer: ViewerDep) -> IdentityRead:
    return identity_read(viewer)
