"""Reverse-proxy helpers used by gateway routes.

Simple httpx-based proxy that forwards method / headers / query / body to an
upstream and streams the response back. Intentionally minimal - we don't use
hop-by-hop header stripping beyond the basics, since upstreams are
localhost-only and under our control.
"""
from __future__ import annotations

from typing import AsyncIterator

import httpx
from fastapi import Request
from fastapi.responses import Response, StreamingResponse

# Headers that must not be forwarded verbatim.
_HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}


def _clean_headers(headers) -> dict[str, str]:
    return {k: v for k, v in headers.items() if k.lower() not in _HOP_BY_HOP}


async def forward(
    request: Request,
    upstream_base: str,
    upstream_path: str,
    *,
    client: httpx.AsyncClient,
    timeout: httpx.Timeout | float | None = None,
) -> Response:
    """Forward the incoming request to `{upstream_base}{upstream_path}`.

    Query string is taken from the incoming request. Response body is
    streamed back as-is. Pass `timeout` to override the client default
    (e.g. `httpx.Timeout(connect=5.0, read=None, write=30.0, pool=None)`
    for long-lived SSE streams).
    """
    url = f"{upstream_base.rstrip('/')}{upstream_path}"
    body = await request.body()

    build_kwargs: dict = dict(
        method=request.method,
        url=url,
        params=request.query_params,
        headers=_clean_headers(request.headers),
        content=body if body else None,
    )
    if timeout is not None:
        build_kwargs["timeout"] = timeout
    upstream_req = client.build_request(**build_kwargs)

    upstream_resp = await client.send(upstream_req, stream=True)

    async def _iter() -> AsyncIterator[bytes]:
        try:
            async for chunk in upstream_resp.aiter_raw():
                yield chunk
        finally:
            await upstream_resp.aclose()

    return StreamingResponse(
        _iter(),
        status_code=upstream_resp.status_code,
        headers=_clean_headers(upstream_resp.headers),
        media_type=upstream_resp.headers.get("content-type"),
    )
