"""
API Gateway — Routes all requests to appropriate microservices.
Enforces CORS, logs requests, provides unified entry point.
"""

import os
import httpx
from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [GATEWAY] %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Crypto Trading Platform — API Gateway",
    description="Central gateway routing to microservices",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN, "http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SERVICE_MAP = {
    "/auth":     os.getenv("AUTH_SERVICE_URL", "http://localhost:8001"),
    "/exchange": os.getenv("EXCHANGE_SERVICE_URL", "http://localhost:8002"),
    "/strategy": os.getenv("STRATEGY_SERVICE_URL", "http://localhost:8003"),
    "/orders":   os.getenv("ORDER_SERVICE_URL", "http://localhost:8004"),
    "/ws":       os.getenv("WS_SERVICE_URL", "http://localhost:8005"),
}


async def proxy_request(request: Request, target_url: str) -> Response:
    """Forward request to target microservice and return its response."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Forward body
        body = await request.body()
        # Forward headers (excluding host)
        headers = {k: v for k, v in request.headers.items() if k.lower() != "host"}
        
        # Diagnostic: Log presence of Authorization header
        has_auth = "authorization" in [h.lower() for h in headers.keys()]
        logger.info(f"Forwarding request to {target_url} (Auth present: {has_auth}, Headers count: {len(headers)})")
        
        try:
            resp = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=body,
                params=dict(request.query_params),
            )
            
            # Filter headers to avoid encoding/length mismatches
            excluded_headers = ["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]
            forward_headers = {
                k: v for k, v in resp.headers.items()
                if k.lower() not in excluded_headers
            }

            return Response(
                content=resp.content,
                status_code=resp.status_code,
                headers=forward_headers,
                media_type=resp.headers.get("content-type"),
            )
        except httpx.ConnectError:
            raise HTTPException(status_code=503, detail=f"Service unavailable: {target_url}")
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Gateway timeout")


@app.api_route(
    "/{service}/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
)
async def gateway_route(service: str, path: str, request: Request):
    prefix = f"/{service}"
    if prefix not in SERVICE_MAP:
        raise HTTPException(status_code=404, detail=f"Unknown service: {service}")

    base_url = SERVICE_MAP[prefix]
    target_url = f"{base_url}/{service}/{path}"
    logger.info(f"{request.method} /{service}/{path} → {target_url}")
    return await proxy_request(request, target_url)


@app.get("/health")
async def health():
    """Gateway health check — also pings each service."""
    statuses = {}
    async with httpx.AsyncClient(timeout=5.0) as client:
        for prefix, url in SERVICE_MAP.items():
            svc = prefix.strip("/")
            try:
                r = await client.get(f"{url}/health")
                statuses[svc] = "healthy" if r.status_code == 200 else "degraded"
            except Exception:
                statuses[svc] = "unreachable"
    return {"gateway": "healthy", "services": statuses}


@app.get("/")
async def root():
    return {
        "platform": "Crypto Trading Platform",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
    }
