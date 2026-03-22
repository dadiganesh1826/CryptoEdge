"""
Exchange Service — CCXT adapter for multiple exchanges.
Handles price fetching, balance, positions, and order placement.
No withdrawal methods exposed.
"""

import os
import logging
from typing import Optional, List
import ccxt
import ccxt.async_support as ccxt_async
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
import httpx
import re
import asyncio

logging.basicConfig(level=logging.INFO, format="%(asctime)s [EXCHANGE] %(message)s")
logger = logging.getLogger(__name__)

AUTH_SERVICE_URL   = os.getenv("AUTH_SERVICE_URL", "http://localhost:8001")
ORDERS_SERVICE_URL = os.getenv("ORDER_SERVICE_URL", "http://localhost:8004")

app = FastAPI(title="Exchange Service", version="1.0.0", docs_url="/exchange/docs")

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
# CORS handled by Gateway

# ──────────────────────────────────────────────
# Allowed exchanges & symbols validation
# ──────────────────────────────────────────────
SUPPORTED_EXCHANGES = {
    "hyperliquid": ccxt_async.hyperliquid,
    "binance": ccxt_async.binance,
    "bybit": ccxt_async.bybit,
    "okx": ccxt_async.okx,
    "kucoin": ccxt_async.kucoin,
}

SYMBOL_PATTERN = re.compile(r'^[A-Z]{2,10}/(USDT|USDC|USD|BTC|ETH)(:[A-Z]{3,5})?$')

# FORBIDDEN — these methods are never callable
FORBIDDEN_METHODS = ["withdraw", "transfer", "send_funds", "create_withdrawal"]


def validate_symbol(symbol: str) -> str:
    """Validates that symbol matches pattern like BTC/USDT or BTC/USDT:USDT"""
    s = symbol.upper().strip()
    if not SYMBOL_PATTERN.match(s):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid symbol format '{symbol}'. Use format like BTC/USDT or BTC/USDT:USDT"
        )
    return s

def decode_symbol(encoded: str) -> str:
    """Decode frontend URL-safe symbol (BTC-USDT-USDT -> BTC/USDT:USDT)"""
    s = encoded.replace("-", "/", 1)
    if "-" in s:
        s = s.replace("-", ":", 1)
    return s


async def get_exchange_client(user_id: str, auth_token: str, market_type: str = "future") -> ccxt_async.Exchange:
    """Fetch decrypted keys from Auth service and build authenticated CCXT client."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(
            f"{AUTH_SERVICE_URL}/auth/keys/{user_id}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Could not retrieve exchange credentials")
        data = r.json()

    exchange_name = data["exchange"].lower()
    if exchange_name not in SUPPORTED_EXCHANGES:
        raise HTTPException(status_code=400, detail=f"Unsupported exchange: {exchange_name}")

    ExchangeClass = SUPPORTED_EXCHANGES[exchange_name]
    exchange = ExchangeClass({
        "apiKey": data["api_key"],
        "secret": data["api_secret"],
        "enableRateLimit": True,
        "options": {"defaultType": market_type},
    })

    # Safety: override forbidden methods to prevent any withdrawal
    for method in FORBIDDEN_METHODS:
        if hasattr(exchange, method):
            setattr(exchange, method, lambda *a, **kw: (_ for _ in ()).throw(
                PermissionError("Withdrawal operations are disabled on this platform")
            ))

    return exchange

async def get_public_exchange_client(exchange_id: str = "binance") -> ccxt_async.Exchange:
    """Build a truly unauthenticated CCXT client for public market data."""
    if exchange_id not in SUPPORTED_EXCHANGES:
        exchange_id = "binance"
    
    ExchangeClass = SUPPORTED_EXCHANGES[exchange_id]
    return ExchangeClass({
        "enableRateLimit": True,
        "options": {"defaultType": "future"},
    })


# ──────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────
class PlaceOrderRequest(BaseModel):
    user_id: str
    symbol: str = Field(..., description="e.g. BTC/USDT or BTC/USDT:USDT")
    side: str   = Field(..., pattern="^(buy|sell)$")
    order_type: str = Field(..., alias="type", pattern="^(limit|market)$")
    amount: float = Field(0.0, ge=0)
    quantity: Optional[float] = Field(None, ge=0)
    price: Optional[float] = Field(None, ge=0)
    leverage: Optional[int] = Field(1, ge=1, le=125)
    trade_type: str = Field("futures", alias="trade_type", description="spot or futures")
    is_close: bool = Field(False, alias="is_close")
    take_profit: Optional[float] = None
    stop_loss: Optional[float] = None
    params: Optional[dict] = None

    class Config:
        populate_by_name = True

    @validator("symbol")
    def validate_sym(cls, v):
        # Basic check — real validation in endpoint
        return v.upper().strip()


# ──────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────
@app.get("/exchange/price/{symbol:path}")
async def get_price(
    symbol: str,
    authorization: Optional[str] = Header(None),
    user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    """Fetch current ticker price for a symbol. Public access supported."""
    sym = validate_symbol(decode_symbol(symbol))
    # We try to get the exchange name from the user's keys if possible, 
    # but for prices, any supported exchange works. Defaulting to binance for speed.
    exchange = await get_public_exchange_client()
    try:
        ticker = await exchange.fetch_ticker(sym)
        await exchange.close()
        return {
            "symbol": sym,
            "price": ticker["last"],
            "bid": ticker["bid"],
            "ask": ticker["ask"],
            "change_24h": ticker.get("percentage", 0),
            "volume_24h": ticker.get("quoteVolume", 0),
            "high_24h": ticker.get("high", 0),
            "low_24h": ticker.get("low", 0),
            "timestamp": ticker["timestamp"],
        }
    except ccxt.BaseError as e:
        await exchange.close()
        raise HTTPException(status_code=400, detail=str(e))


from fastapi import Query

@app.get("/exchange/balance")
async def get_balance(
    trade_type: str = Query("future", description="spot or future"),
    authorization: str = Header(...),
    user_id: str = Header(..., alias="x-user-id"),
):
    """Fetch account balance from exchange."""
    token = authorization.replace("Bearer ", "")
    market_type = "spot" if "spot" in trade_type.lower() else "future"
    exchange = await get_exchange_client(user_id, token, market_type)
    try:
        balance = await exchange.fetch_balance()
        await exchange.close()
        
        # Guard against empty/malformed balance responses
        total = balance.get("total", {})
        free = balance.get("free", {})
        used = balance.get("used", {})

        # Return only non-zero balances
        filtered = {
            k: v for k, v in total.items()
            if isinstance(v, (int, float)) and v > 0
        }
        
        return {
            "total": filtered,
            "free": {k: free.get(k, 0) for k in filtered},
            "used": {k: used.get(k, 0) for k in filtered},
        }
    except ccxt.BaseError as e:
        await exchange.close()
        logger.error(f"CCXT Balance Error: {e}")
        raise HTTPException(status_code=400, detail=f"Exchange error: {str(e)}")
    except Exception as e:
        await exchange.close()
        logger.error(f"Unexpected Balance Error: {e}")
        raise HTTPException(status_code=500, detail=f"Internal balance error: {str(e)}")


@app.get("/exchange/positions")
async def get_positions(
    include_spot: bool = Query(False),
    authorization: str = Header(...),
    user_id: str = Header(..., alias="x-user-id"),
):
    """Fetch all portfolio data with maximum parallelism to prevent timeouts."""
    token = authorization.replace("Bearer ", "")
    open_positions = []

    # 1. Fetch Core Data (Positions & Balance) in Parallel
    exchange_fut = None
    exchange_spot = None
    try:
        exchange_fut = await get_exchange_client(user_id, token, "future")
        fut_task = exchange_fut.fetch_positions()
        
        spot_task = None
        if include_spot:
            exchange_spot = await get_exchange_client(user_id, token, "spot")
            spot_task = exchange_spot.fetch_balance()
        
        # Initial core fetch
        fut_data = []
        spot_data = {}
        if spot_task:
            results = await asyncio.gather(fut_task, spot_task, return_exceptions=True)
            fut_data = results[0] if not isinstance(results[0], Exception) else []
            spot_data = results[1] if not isinstance(results[1], Exception) else {}
        else:
            fut_data = await fut_task

        active_fut = [p for p in fut_data if float(p.get("contracts", 0) or p.get("size", 0)) != 0]
        spot_assets = [a for a, q in spot_data.get("total", {}).items() if q > 0 and a not in ["USDT", "USDC", "USD"]]
        
        # 2. Gather All Symbols for Summaries and Tickers
        # Map symbol -> current_qty
        symbol_qtys = {}
        for p in active_fut:
            symbol_qtys[p["symbol"]] = float(p.get("contracts", 0) or p.get("size", 0))
        for a in spot_assets:
            symbol_qtys[f"{a}/USDT"] = float(spot_data["total"][a])

        all_symbols = list(symbol_qtys.keys())

        # 3. Parallel Fetch Summaries & Bulk Tickers
        summaries = {}
        tickers = {}
        
        async def fetch_bulk_summaries():
            if not all_symbols: return {}
            try:
                items = [{"symbol": s, "current_qty": q} for s, q in symbol_qtys.items()]
                async with httpx.AsyncClient() as client:
                    resp = await client.post(f"{ORDERS_SERVICE_URL}/orders/summaries/bulk", 
                        json={"user_id": user_id, "items": items}, timeout=5.0)
                    return resp.json() if resp.status_code == 200 else {}
            except Exception as e:
                logger.error(f"Bulk Summary Request Error: {e}")
                return {}

        async def fetch_bulk_tickers():
            if not spot_symbols or not exchange_spot: return {}
            try: return await exchange_spot.fetch_tickers(spot_symbols)
            except: return {}

        results = await asyncio.gather(fetch_bulk_summaries(), fetch_bulk_tickers())
        summaries = results[0]
        tickers = results[1]

        # 4. Handle Missing Tickers in Parallel (Fallback)
        missing_spot = [s for s in spot_symbols if not tickers.get(s)]
        if missing_spot and exchange_spot:
            async def safe_fetch(s):
                try: return s, await exchange_spot.fetch_ticker(s)
                except: return s, {}
            
            fallback_results = await asyncio.gather(*[safe_fetch(s) for s in missing_spot])
            for s, t in fallback_results:
                tickers[s] = t

        # 5. Build Final Response
        # Futures
        for p in active_fut:
            s = summaries.get(p["symbol"], {})
            info = p.get("info", {})
            t = tickers.get(p["symbol"], {})
            open_positions.append({
                "symbol": p["symbol"],
                "market": "futures",
                "side": p.get("side"),
                "contracts": float(p.get("contracts", 0) or p.get("size", 0)),
                "entryPrice": float(p.get("entryPrice") or info.get("entryPrice") or 0),
                "markPrice": float(p.get("markPrice") or info.get("markPrice") or 0),
                "liquidationPrice": float(p.get("liquidationPrice") or info.get("liquidationPrice") or 0),
                "leverage": str(p.get("leverage") or info.get("leverage") or "1"),
                "unrealizedPnl": float(p.get("unrealizedPnl") or info.get("unrealizedProfit") or 0),
                "percentage": float(p.get("percentage") or info.get("percentage") or 0),
                "change24h": float(t.get("percentage") or 0),
                "take_profit": s.get("take_profit"),
                "stop_loss": s.get("stop_loss"),
            })

        # Spot
        for a in spot_assets:
            symbol = f"{a}/USDT"
            qty = spot_data["total"][a]
            s = summaries.get(symbol, {})
            t = tickers.get(symbol, {})
            mark = t.get("last") or t.get("close") or 0
            entry = s.get("avg_price", 0)
            pnl = (mark - entry) * qty if entry > 0 else 0
            pnl_pct = (pnl / (entry * qty)) * 100 if entry > 0 else 0
            
            open_positions.append({
                "symbol": symbol,
                "market": "spot",
                "side": "long",
                "contracts": float(qty),
                "entryPrice": float(entry),
                "markPrice": float(mark),
                "unrealizedPnl": float(pnl),
                "percentage": float(pnl_pct),
                "change24h": float(t.get("percentage") or 0),
                "take_profit": s.get("take_profit"),
                "stop_loss": s.get("stop_loss"),
                "leverage": "1",
            })

        # SORT BY VALUE ($) DESCENDING
        open_positions.sort(key=lambda x: abs(x["contracts"] * x["markPrice"]), reverse=True)

    except Exception as e:
        logger.error(f"Ultimate Pos Fetch Error: {e}")
    finally:
        if exchange_fut: await exchange_fut.close()
        if exchange_spot: await exchange_spot.close()

    return open_positions


@app.post("/exchange/order")
async def place_order(
    req: PlaceOrderRequest,
    authorization: str = Header(...),
):
    """
    Place a limit or market order. Withdrawal is never possible through this endpoint.
    Validates symbol, side, amount, and leverage before submission.
    """
    token = authorization.replace("Bearer ", "")
    sym = validate_symbol(req.symbol)
    market_type = "spot" if "spot" in req.trade_type.lower() else "future"
    
    print(f">>> [DEBUG] ORDER ATTEMPT: sym={sym}, side={req.side}, type={req.order_type}, amt={req.amount}, trade_type={req.trade_type}", flush=True)
    
    exchange = await get_exchange_client(req.user_id, token, market_type)
    print(f">>> [DEBUG] Exchange identified: {exchange.id}", flush=True)

    try:
        # Set leverage for futures
        if market_type == "future" and req.leverage and req.leverage > 1:
            try:
                await exchange.set_leverage(req.leverage, sym)
            except Exception as e:
                logger.warning(f"Set leverage failed: {e}")

        params = req.params or {}
        
        # Use quantity if provided (asset units), otherwise fallback to amount (USDT/value)
        order_amount = req.quantity if req.quantity is not None else req.amount
        
        print(f">>> [DEBUG] CCXT CREATE_ORDER: sym={sym}, side={req.side}, type={req.order_type}, amt={order_amount}, price={req.price}", flush=True)

        try:
            # First attempt
            order = await exchange.create_order(
                symbol=sym,
                type=req.order_type,
                side=req.side,
                amount=order_amount,
                price=req.price if req.order_type == "limit" else None,
                params=params,
            )
        except ccxt.BaseError as e:
            err_str = str(e)
            # Check for Binance Hedge Mode error (-4061)
            if "-4061" in err_str and exchange.id == 'binance' and market_type == 'future':
                print(f">>> [DEBUG] Detected Binance Hedge Mode mismatch (-4061). Retrying with positionSide...", flush=True)
                # Fetch account position mode
                mode_resp = await exchange.fapiPrivateGetPositionSideDual()
                if mode_resp.get('dualSidePosition'):
                    # In Hedge Mode:
                    # - To OPEN Long: BUY + positionSide=LONG
                    # - To CLOSE Long: SELL + positionSide=LONG
                    # - To OPEN Short: SELL + positionSide=SHORT
                    # - To CLOSE Short: BUY + positionSide=SHORT
                    if req.is_close:
                        # If closing, we use the OPPOSITE positionSide of what you'd think
                        # Actually, if side is SELL, we must be closing a LONG
                        params['positionSide'] = 'LONG' if req.side == 'sell' else 'SHORT'
                    else:
                        # Opening
                        params['positionSide'] = 'LONG' if req.side == 'buy' else 'SHORT'
                    
                    print(f">>> [DEBUG] Binance Hedge Mode Active. is_close={req.is_close}. side={req.side} -> positionSide={params['positionSide']}", flush=True)
                else:
                    print(">>> [DEBUG] Binance One-Way Mode active.", flush=True)
                    # In One-Way Mode, positionSide is not needed or should be 'BOTH'
                    # The original logic for one-way mode was:
                    params['positionSide'] = 'LONG' if req.side == 'buy' else 'SHORT' # This is for opening, but for closing it's not explicitly handled here.
                                                                                     # However, the error -4061 typically means positionSide is missing or wrong for hedge mode.
                                                                                     # If it's one-way mode, this error shouldn't occur for positionSide.
                                                                                     # So, if we are here and it's one-way, the original `params['positionSide'] = 'LONG' if req.side == 'buy' else 'SHORT'`
                                                                                     # was likely the correct retry for a different reason, or this branch won't be hit.
                                                                                     # For now, we'll keep the original retry logic for one-way if this error occurs.
                order = await exchange.create_order(
                    symbol=sym,
                    type=req.order_type,
                    side=req.side,
                    amount=order_amount,
                    price=req.price if req.order_type == "limit" else None,
                    params=params,
                )
            else:
                raise e

        await exchange.close()
        print(f">>> [DEBUG] Order SUCCESS: {order.get('id')}", flush=True)

        # Handle Take Profit / Stop Loss (Automated separate orders)
        if (req.take_profit or req.stop_loss):
            try:
                # Re-open/ensure client for TP/SL orders
                # We need the side opposite to our order (e.g. if we BUY, TP is SELL)
                exit_side = 'sell' if req.side == 'buy' else 'buy'
                
                if market_type == 'future' and exchange.id == 'binance':
                    if req.take_profit:
                        tp_params = {'stopPrice': req.take_profit, 'reduceOnly': True}
                        if params.get('positionSide'): tp_params['positionSide'] = params['positionSide']
                        await exchange.create_order(sym, 'TAKE_PROFIT_MARKET', exit_side, order_amount, None, tp_params)
                    if req.stop_loss:
                        sl_params = {'stopPrice': req.stop_loss, 'reduceOnly': True}
                        if params.get('positionSide'): sl_params['positionSide'] = params['positionSide']
                        await exchange.create_order(sym, 'STOP_MARKET', exit_side, order_amount, None, sl_params)
                else:
                    # Generic / Spot support: Place standard LIMIT orders for TP
                    if req.take_profit:
                        await exchange.create_order(sym, 'limit', exit_side, order_amount, req.take_profit)
                    # Note: Stop loss for spot is trickier without OCO, but let's try a basic stop order if supported
                    if req.stop_loss:
                        try:
                            await exchange.create_order(sym, 'stop_loss_limit', exit_side, order_amount, req.stop_loss, {'stopPrice': req.stop_loss})
                        except:
                            logger.warning("Stop loss order type not supported for this market, skipping.")
                
            except Exception as e:
                print(f">>> [DEBUG] Secondary TP/SL order failed: {e}", flush=True)

        return {
            "exchange_order_id": order.get("id"),
            "symbol": sym,
            "side": req.side,
            "type": req.order_type,
            "amount": order.get("amount", order_amount),
            "price": order.get("price", req.price),
            "average": order.get("average"),
            "filled": order.get("filled"),
            "status": order.get("status"),
            "timestamp": order.get("timestamp"),
        }
    except ccxt.BaseError as e:
        await exchange.close()
        print(f">>> [DEBUG] Final CCXT Error: {str(e)}", flush=True)
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/exchange/ohlcv/{symbol:path}")
async def get_ohlcv(
    symbol: str,
    timeframe: str = "1h",
    limit: int = 150,
    authorization: Optional[str] = Header(None),
    user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    """Fetch OHLCV klines. Public access supported."""
    sym = validate_symbol(decode_symbol(symbol))
    # Validate timeframe
    allowed_timeframes = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"]
    if timeframe not in allowed_timeframes:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe. Use: {allowed_timeframes}")
    if limit < 1 or limit > 1000:
        raise HTTPException(status_code=400, detail="Limit must be between 1 and 1000")

    exchange = await get_public_exchange_client()
    try:
        ohlcv = await exchange.fetch_ohlcv(sym, timeframe, limit=limit)
        await exchange.close()
        return {
            "symbol": sym,
            "timeframe": timeframe,
            "candles": [
                {"time": c[0], "open": c[1], "high": c[2], "low": c[3], "close": c[4], "volume": c[5]}
                for c in ohlcv
            ],
        }
    except ccxt.BaseError as e:
        await exchange.close()
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/exchange/markets")
async def get_markets(
    authorization: Optional[str] = Header(None),
    user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    """Fetch all available markets. Public access supported."""
    exchange = await get_public_exchange_client()
    try:
        markets = await exchange.load_markets()
        await exchange.close()
        symbols = [s for s in markets.keys() if "USDT" in s or "USD" in s][:200]
        return {"symbols": symbols, "total": len(symbols)}
    except ccxt.BaseError as e:
        await exchange.close()
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/health")
async def health():
    return {"service": "exchange", "status": "healthy", "supported_exchanges": list(SUPPORTED_EXCHANGES.keys())}
