"""
WebSocket Service — Real-time price, order, and balance broadcasts.
Connects to exchange via CCXT and pushes updates to all connected clients.
"""

import os
import asyncio
import json
import logging
from typing import Set, Dict
from datetime import datetime

import ccxt.async_support as ccxt_async
import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s [WEBSOCKET] %(message)s")
logger = logging.getLogger(__name__)

EXCHANGE_SVC_URL = os.getenv("EXCHANGE_SERVICE_URL", "http://localhost:8002")
AUTH_SVC_URL     = os.getenv("AUTH_SERVICE_URL", "http://localhost:8001")

app = FastAPI(title="WebSocket Service", version="1.0.0", docs_url="/ws/docs")

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
# CORS handled by Gateway


# ──────────────────────────────────────────────
# Connection Manager
# ──────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        # user_id → set of websockets
        self.active: Dict[str, Set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        if user_id not in self.active:
            self.active[user_id] = set()
        self.active[user_id].add(websocket)
        logger.info(f"WS connected: user={user_id} total_users={len(self.active)}")

    def disconnect(self, websocket: WebSocket, user_id: str):
        if user_id in self.active:
            self.active[user_id].discard(websocket)
            if not self.active[user_id]:
                del self.active[user_id]
        logger.info(f"WS disconnected: user={user_id}")

    async def send_to_user(self, user_id: str, message: dict):
        if user_id not in self.active:
            return
        dead = set()
        for ws in self.active[user_id]:
            try:
                await ws.send_json(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.active[user_id].discard(ws)

    async def broadcast(self, message: dict):
        """Send to all connected clients."""
        for user_id in list(self.active.keys()):
            await self.send_to_user(user_id, message)

    @property
    def total_connections(self):
        return sum(len(v) for v in self.active.values())


manager = ConnectionManager()

# Price cache to avoid re-fetching identical prices
price_cache: Dict[str, float] = {}


# ──────────────────────────────────────────────
# WebSocket Endpoint
# ──────────────────────────────────────────────
@app.websocket("/ws/connect")
async def websocket_endpoint(
    websocket: WebSocket,
    user_id: str = Query(...),
    token: str = Query(...),
    symbol: str = Query("BTC/USDT:USDT"),
):
    """
    WebSocket endpoint. Client sends {type: "subscribe", symbol: "BTC/USDT:USDT"}
    Server broadcasts price updates every second.
    """
    await manager.connect(websocket, user_id)

    # Send welcome
    await websocket.send_json({
        "type": "connected",
        "message": f"Connected to price feed for {symbol}",
        "timestamp": datetime.utcnow().isoformat(),
    })

    current_symbol = symbol
    price_task = asyncio.create_task(
        price_feed_loop(websocket, user_id, token, current_symbol)
    )

    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "subscribe":
                    new_sym = msg.get("symbol", current_symbol)
                    if new_sym != current_symbol:
                        current_symbol = new_sym
                        price_task.cancel()
                        price_task = asyncio.create_task(
                            price_feed_loop(websocket, user_id, token, current_symbol)
                        )
                        await websocket.send_json({
                            "type": "subscribed",
                            "symbol": current_symbol,
                        })
                elif msg.get("type") == "ping":
                    await websocket.send_json({"type": "pong", "timestamp": datetime.utcnow().isoformat()})
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        price_task.cancel()
        manager.disconnect(websocket, user_id)


async def price_feed_loop(websocket: WebSocket, user_id: str, token: str, symbol: str):
    """Continuously fetch price from exchange service and push to client."""
    symbol_path = symbol.replace("/", "-").replace(":", "-")
    consecutive_errors = 0

    while True:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    f"{EXCHANGE_SVC_URL}/exchange/price/{symbol_path}",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "x-user-id": user_id,
                    }
                )
                if resp.status_code == 200:
                    data = resp.json()
                    consecutive_errors = 0
                    await websocket.send_json({
                        "type": "price",
                        "symbol": symbol,
                        "price": data["price"],
                        "bid": data.get("bid"),
                        "ask": data.get("ask"),
                        "change_24h": data.get("change_24h", 0),
                        "volume_24h": data.get("volume_24h", 0),
                        "high_24h": data.get("high_24h", 0),
                        "low_24h": data.get("low_24h", 0),
                        "timestamp": datetime.utcnow().isoformat(),
                    })
                else:
                    consecutive_errors += 1
        except asyncio.CancelledError:
            break
        except Exception as e:
            consecutive_errors += 1
            if consecutive_errors <= 3:
                await websocket.send_json({
                    "type": "error",
                    "message": f"Price feed error: {str(e)[:100]}",
                })

        if consecutive_errors > 10:
            await websocket.send_json({"type": "error", "message": "Too many failures. Reconnect required."})
            break

        await asyncio.sleep(1)  # 1-second interval


@app.get("/ws/stats")
async def ws_stats():
    return {
        "service": "websocket",
        "total_connections": manager.total_connections,
        "connected_users": len(manager.active),
    }


@app.get("/health")
async def health():
    return {
        "service": "websocket",
        "status": "healthy",
        "connections": manager.total_connections,
    }
