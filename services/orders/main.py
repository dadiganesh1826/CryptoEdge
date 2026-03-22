"""
Orders Service — Manages order placement, tracking, and history.
Prevents duplicate per-level strategy orders.
"""

import os
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional, List

import httpx
from fastapi import FastAPI, HTTPException, Header, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.dialects.postgresql import UUID
from pydantic import BaseModel, Field, validator

logging.basicConfig(level=logging.INFO, format="%(asctime)s [ORDERS] %(message)s")
logger = logging.getLogger(__name__)

DATABASE_URL     = os.getenv("DATABASE_URL", "postgresql://cryptotrader:CryptoSecure2024!@localhost:5432/cryptotrading")
EXCHANGE_SVC_URL = os.getenv("EXCHANGE_SERVICE_URL", "http://localhost:8002")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


class OrderModel(Base):
    __tablename__ = "orders"
    id                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    strategy_id       = Column(UUID(as_uuid=True), nullable=True)
    user_id           = Column(UUID(as_uuid=True), nullable=False)
    symbol            = Column(String(20), nullable=False)
    level             = Column(Integer, nullable=True)
    price             = Column(Float, nullable=False)
    amount            = Column(Float, nullable=False)
    quantity          = Column(Float, nullable=True)
    leverage          = Column(Integer, default=1)
    side              = Column(String(10), nullable=False)
    order_type        = Column(String(20), nullable=False)
    trade_type        = Column(String(20), default="futures")
    exchange_order_id = Column(String(200), nullable=True)
    status            = Column(String(20), default="pending")
    is_close          = Column(Integer, default=0) # 0 for open, 1 for close
    realized_pnl      = Column(Float, default=0.0)
    take_profit       = Column(Float, nullable=True)
    stop_loss         = Column(Float, nullable=True)
    filled_at         = Column(DateTime(timezone=True), nullable=True)
    created_at        = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at        = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ──────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────
class PlaceOrderRequest(BaseModel):
    user_id: str
    strategy_id: Optional[str] = None
    symbol: str
    level: Optional[int] = None
    price: Optional[float] = Field(None, ge=0)
    amount: float = Field(0.0, ge=0)
    quantity: Optional[float] = Field(None, ge=0)
    leverage: int = Field(1, ge=1, le=125)
    side: str = Field(..., pattern="^(buy|sell)$")
    order_type: str = Field(..., pattern="^(limit|market)$")
    trade_type: str = Field("futures", pattern="^(spot|futures)$")
    is_close: bool = Field(False)
    take_profit: Optional[float] = None
    stop_loss: Optional[float] = None

    @validator("symbol")
    def upper_sym(cls, v):
        return v.upper().strip()


class OrderResponse(BaseModel):
    id: str
    strategy_id: Optional[str]
    user_id: str
    symbol: str
    level: Optional[int]
    price: float
    amount: float
    quantity: Optional[float]
    leverage: int
    side: str
    order_type: str
    trade_type: str
    exchange_order_id: Optional[str]
    status: str
    realized_pnl: float
    is_close: bool
    take_profit: Optional[float]
    stop_loss: Optional[float]
    filled_at: Optional[datetime]
    created_at: datetime


# ──────────────────────────────────────────────
# App
# ──────────────────────────────────────────────
app = FastAPI(title="Orders Service", version="1.0.0", docs_url="/orders/docs")

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
# CORS handled by Gateway


@app.post("/orders/place", response_model=OrderResponse)
async def place_order(
    req: PlaceOrderRequest,
    authorization: str = Header(...),
    db: Session = Depends(get_db),
):
    """
    Place an order. For strategy orders, checks for duplicate level execution.
    Forwards to Exchange Service for actual submission.
    """
    token = authorization.replace("Bearer ", "")

    # Prevent duplicate strategy level orders
    if req.strategy_id and req.level is not None:
        existing = db.query(OrderModel).filter(
            OrderModel.strategy_id == uuid.UUID(req.strategy_id),
            OrderModel.level == req.level,
            OrderModel.status.in_(["pending", "open", "filled"]),
        ).first()
        if existing:
            logger.warning(f"Duplicate order attempt: strategy={req.strategy_id} level={req.level}")
            raise HTTPException(
                status_code=409,
                detail=f"Order for strategy level {req.level} already exists"
            )

    # Calculate quantity if not provided
    quantity = req.quantity
    if not quantity:
        p_val = req.price or 1.0 # Fallback to avoid division by zero
        position_size = req.amount * req.leverage
        quantity = round(position_size / p_val, 6)

    # Calculate realized PnL if this is a closing trade
    realized_pnl = 0.0
    if req.is_close:
        try:
            # Find the weighted avg cost for this symbol
            # We already have a summary endpoint, let's use the local DB logic directly
            buy_orders = db.query(OrderModel).filter(
                OrderModel.user_id == uuid.UUID(req.user_id),
                OrderModel.symbol == req.symbol.upper(),
                OrderModel.side == ("buy" if req.trade_type == "spot" else ("sell" if req.side == "buy" else "buy")),
                OrderModel.status == "filled",
                OrderModel.is_close == 0
            ).all()
            
            if buy_orders:
                total_entry_cost = sum(o.price * o.quantity for o in buy_orders if o.price and o.quantity)
                total_entry_qty = sum(o.quantity for o in buy_orders if o.quantity)
                avg_entry_price = total_entry_cost / total_entry_qty if total_entry_qty > 0 else 0
                
                if avg_entry_price > 0 and req.price is not None:
                    # PnL = (Exit - Entry) * Qty (for Long/Spot)
                    # PnL = (Entry - Exit) * Qty (for Short)
                    is_short = req.trade_type == "futures" and req.side == "buy" # Buying back a short
                    if is_short:
                        realized_pnl = (avg_entry_price - req.price) * quantity
                    else:
                        realized_pnl = (req.price - avg_entry_price) * quantity
        except Exception as e:
            logger.error(f"Failed to calculate realized PnL: {e}")

    # Create DB record (pending)
    order = OrderModel(
        strategy_id=uuid.UUID(req.strategy_id) if req.strategy_id else None,
        user_id=uuid.UUID(req.user_id),
        symbol=req.symbol,
        level=req.level,
        price=req.price,
        amount=req.amount,
        quantity=quantity,
        leverage=req.leverage,
        side=req.side,
        order_type=req.order_type,
        trade_type=req.trade_type,
        take_profit=req.take_profit,
        stop_loss=req.stop_loss,
        is_close=1 if req.is_close else 0,
        realized_pnl=realized_pnl,
        status="pending",
    )
    db.add(order)
    db.commit()
    db.refresh(order)

    # Forward to exchange service
    exchange_order_id = None
    order_status = "open"
    error_detail = None
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{EXCHANGE_SVC_URL}/exchange/order",
                json={
                    "user_id": req.user_id,
                    "symbol": req.symbol,
                    "side": req.side,
                    "type": req.order_type,
                    "amount": quantity,
                    "price": req.price if req.order_type == "limit" else None,
                    "leverage": req.leverage,
                    "trade_type": req.trade_type,
                    "is_close": req.is_close,
                    "take_profit": req.take_profit,
                    "stop_loss": req.stop_loss,
                },
                headers={
                    "Authorization": f"Bearer {token}",
                    "x-user-id": req.user_id,
                }
            )
            if resp.status_code == 200:
                data = resp.json()
                exchange_order_id = data.get("exchange_order_id")
                exchange_status = data.get("status")
                
                # Capture accurate fill price/avg for market orders
                avg_price = data.get("average") or data.get("price")
                filled_qty = data.get("filled") or data.get("amount")
                
                if avg_price: order.price = avg_price
                if filled_qty: order.quantity = filled_qty
                
                # Update realized PnL for market orders (close) if not calculated earlier
                if avg_price and req.is_close and order.realized_pnl == 0:
                    try:
                        # Recalculate avg_entry_price for the position
                        buy_orders = db.query(OrderModel).filter(
                            OrderModel.user_id == uuid.UUID(req.user_id),
                            OrderModel.symbol == req.symbol.upper(),
                            OrderModel.side == ("buy" if req.trade_type == "spot" else ("sell" if req.side == "buy" else "buy")),
                            OrderModel.status == "filled",
                            OrderModel.is_close == 0
                        ).all()
                        if buy_orders:
                            total_entry_cost = sum(o.price * o.quantity for o in buy_orders if o.price and o.quantity)
                            total_entry_qty = sum(o.quantity for o in buy_orders if o.quantity)
                            aep = total_entry_cost / total_entry_qty if total_entry_qty > 0 else 0
                            if aep > 0:
                                is_short = req.trade_type == "futures" and req.side == "buy"
                                if is_short:
                                    order.realized_pnl = (aep - avg_price) * (filled_qty or order.quantity)
                                else:
                                    order.realized_pnl = (avg_price - aep) * (filled_qty or order.quantity)
                    except Exception as pnl_err:
                        logger.error(f"Post-order PnL update failed: {pnl_err}")
                
                # CCXT status mapping: closed -> filled
                # CCXT status mapping: closed/OK -> filled
                if exchange_status in ["closed", "filled", "OK", "success"]:
                    order_status = "filled"
                    order.filled_at = datetime.now(timezone.utc)
                elif exchange_status in ["canceled", "cancelled"]:
                    order_status = "cancelled"
                elif req.order_type == "market" and exchange_status is None:
                    # Market orders that return without error are usually filled
                    order_status = "filled"
                    order.filled_at = datetime.now(timezone.utc)
                else:
                    order_status = "open"
                
                logger.info(f"Order submitted to exchange: {exchange_order_id} with status {order_status}")

                # --- CREATE LINKED TP/SL RECORDS FOR VISIBILITY ---
                if req.take_profit:
                    tp_order = OrderModel(
                        user_id=uuid.UUID(req.user_id),
                        symbol=req.symbol,
                        side='sell' if req.side == 'buy' else 'buy',
                        price=req.take_profit,
                        amount=req.amount,
                        quantity=order.quantity,
                        leverage=req.leverage,
                        order_type="limit",
                        trade_type=req.trade_type,
                        status="open", # It's a pending limit order
                        is_close=1,
                        strategy_id=order.strategy_id
                    )
                    db.add(tp_order)
                
                if req.stop_loss:
                    sl_order = OrderModel(
                        user_id=uuid.UUID(req.user_id),
                        symbol=req.symbol,
                        side='sell' if req.side == 'buy' else 'buy',
                        price=req.stop_loss,
                        amount=req.amount,
                        quantity=order.quantity,
                        leverage=req.leverage,
                        order_type="stop_market",
                        trade_type=req.trade_type,
                        status="open",
                        is_close=1,
                        strategy_id=order.strategy_id
                    )
                    db.add(sl_order)
                
                db.commit()

            else:
                order_status = "failed"
                error_detail = (await resp.json()).get("detail", "Unknown error")
                logger.error(f"Exchange order failed: {resp.text}")
    except Exception as e:
        logger.error(f"Forwarding to exchange failed: {e}")
        order_status = "failed"
        error_detail = str(e)

    # Update order record
    order.exchange_order_id = exchange_order_id
    order.status = order_status
    order.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(order)

    # If it failed immediately, bubble the error to the UI
    if order_status == "failed" and error_detail:
        raise HTTPException(status_code=400, detail=error_detail)

    return OrderResponse(
        id=str(order.id),
        strategy_id=str(order.strategy_id) if order.strategy_id else None,
        user_id=str(order.user_id),
        symbol=order.symbol,
        level=order.level,
        price=order.price,
        amount=order.amount,
        quantity=order.quantity,
        leverage=order.leverage,
        side=order.side,
        order_type=order.order_type,
        trade_type=order.trade_type,
        exchange_order_id=order.exchange_order_id,
        status=order.status,
        realized_pnl=order.realized_pnl,
        is_close=bool(order.is_close),
        take_profit=order.take_profit,
        stop_loss=order.stop_loss,
        filled_at=order.filled_at.isoformat() if order.filled_at else None,
        created_at=order.created_at.isoformat(),
    )


@app.get("/orders/user/{user_id}")
async def get_user_orders(
    user_id: str,
    status: Optional[str] = Query(None),
    symbol: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
):
    """Get all orders for a user, optionally filtered by status or symbol."""
    query = db.query(OrderModel).filter(OrderModel.user_id == uuid.UUID(user_id))
    if status:
        query = query.filter(OrderModel.status == status)
    if symbol:
        query = query.filter(OrderModel.symbol == symbol.upper())

    orders = query.order_by(OrderModel.created_at.desc()).limit(limit).all()
    logger.info(f"Found {len(orders)} orders for user {user_id}")
    return {
        "orders": [
            {
                "id": str(o.id),
                "strategy_id": str(o.strategy_id) if o.strategy_id else None,
                "symbol": o.symbol,
                "level": o.level,
                "price": o.price,
                "amount": o.amount,
                "quantity": o.quantity,
                "leverage": o.leverage,
                "side": o.side,
                "order_type": o.order_type,
                "trade_type": o.trade_type,
                "exchange_order_id": o.exchange_order_id,
                "status": o.status,
                "take_profit": o.take_profit,
                "stop_loss": o.stop_loss,
                "filled_at": o.filled_at.isoformat() if o.filled_at else None,
                "created_at": o.created_at.isoformat(),
            }
            for o in orders
        ],
        "total": len(orders),
    }


@app.get("/orders/strategy/{strategy_id}")
async def get_strategy_orders(strategy_id: str, db: Session = Depends(get_db)):
    """Get all orders for a specific strategy."""
    orders = db.query(OrderModel).filter(
        OrderModel.strategy_id == uuid.UUID(strategy_id)
    ).order_by(OrderModel.level).all()
    return {
        "orders": [
            {
                "id": str(o.id),
                "level": o.level,
                "price": o.price,
                "amount": o.amount,
                "quantity": o.quantity,
                "side": o.side,
                "status": o.status,
                "exchange_order_id": o.exchange_order_id,
                "filled_at": o.filled_at.isoformat() if o.filled_at else None,
                "created_at": o.created_at.isoformat(),
            }
            for o in orders
        ]
    }


class BulkSummaryRequest(BaseModel):
    user_id: str
    symbols: list[str]

@app.post("/orders/summaries/bulk")
async def get_bulk_summaries(req: BulkSummaryRequest, db: Session = Depends(get_db)):
    """Fetch weighted average entry prices for multiple symbols in one go."""
    results = {}
    try:
        user_uuid = uuid.UUID(req.user_id)
    except:
        return {}

    for symbol in req.symbols:
        orders = db.query(OrderModel).filter(
            OrderModel.user_id == user_uuid,
            OrderModel.symbol == symbol.upper(),
            OrderModel.side == "buy",
            OrderModel.status.in_(["filled", "partially_filled", "open"]),
            OrderModel.is_close == 0
        ).all()
        
        if not orders:
            results[symbol] = {"avg_price": 0, "total_qty": 0}
            continue
            
        total_cost = sum(o.price * o.quantity for o in orders if o.price and o.quantity)
        total_qty = sum(o.quantity for o in orders if o.quantity)
        avg_price = total_cost / total_qty if total_qty > 0 else 0
        
        latest = orders[-1]
        results[symbol] = {
            "avg_price": avg_price,
            "total_qty": total_qty,
            "take_profit": latest.take_profit,
            "stop_loss": latest.stop_loss
        }
    return results

@app.get("/orders/summary/{user_id}/{symbol:path}")
async def get_order_summary(user_id: str, symbol: str, db: Session = Depends(get_db)):
    """Calculate weighted average entry price for a symbol based on filled buy orders."""
    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user ID format")

    # Find all filled buy orders for this symbol
    orders = db.query(OrderModel).filter(
        OrderModel.user_id == user_uuid,
        OrderModel.symbol == symbol.upper(),
        OrderModel.side == "buy",
        OrderModel.status.in_(["filled", "partially_filled", "open"]),
        OrderModel.is_close == 0
    ).all()
    
    if not orders:
        return {"symbol": symbol, "avg_price": 0, "total_qty": 0, "take_profit": None, "stop_loss": None}
        
    total_cost = sum(o.price * o.quantity for o in orders if o.price and o.quantity)
    total_qty = sum(o.quantity for o in orders if o.quantity)
    
    avg_price = total_cost / total_qty if total_qty > 0 else 0
    
    # Get the latest order to find TP/SL if set
    latest = orders[-1]
    
    return {
        "symbol": symbol,
        "avg_price": avg_price,
        "total_qty": total_qty,
        "take_profit": latest.take_profit,
        "stop_loss": latest.stop_loss,
        "order_count": len(orders)
    }


@app.delete("/orders/{order_id}")
async def cancel_order(order_id: str, db: Session = Depends(get_db)):
    """Cancel a pending order."""
    order = db.query(OrderModel).filter(OrderModel.id == uuid.UUID(order_id)).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status in ["filled", "cancelled"]:
        raise HTTPException(status_code=400, detail=f"Cannot cancel order in status: {order.status}")

    order.status = "cancelled"
    order.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Order cancelled", "order_id": order_id}


@app.get("/orders/history/{user_id}", response_model=List[OrderResponse])
async def get_order_history(user_id: str, db: Session = Depends(get_db)):
    """Fetch filled or cancelled orders (history)."""
    orders = db.query(OrderModel).filter(
        OrderModel.user_id == uuid.UUID(user_id),
        OrderModel.status.in_(["filled", "cancelled"])
    ).order_by(OrderModel.created_at.desc()).limit(50).all()
    
    return [
        OrderResponse(
            id=str(o.id),
            strategy_id=str(o.strategy_id) if o.strategy_id else None,
            user_id=str(o.user_id),
            symbol=o.symbol,
            level=o.level,
            price=o.price,
            amount=o.amount,
            quantity=o.quantity,
            leverage=o.leverage,
            side=o.side,
            order_type=o.order_type,
            trade_type=o.trade_type,
            exchange_order_id=o.exchange_order_id,
            status=o.status,
            realized_pnl=o.realized_pnl,
            is_close=bool(o.is_close),
            take_profit=o.take_profit,
            stop_loss=o.stop_loss,
            filled_at=o.filled_at,
            created_at=o.created_at
        )
        for o in orders
    ]


@app.post("/orders/tpsl/{order_id}")
async def update_tpsl(
    order_id: str,
    req: dict, # {take_profit: float, stop_loss: float}
    authorization: str = Header(...),
    db: Session = Depends(get_db)
):
    """Update TP/SL for an existing order/position."""
    order = db.query(OrderModel).filter(OrderModel.id == uuid.UUID(order_id)).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    tp = req.get("take_profit")
    sl = req.get("stop_loss")
    
    # 1. Update DB
    order.take_profit = tp
    order.stop_loss = sl
    order.updated_at = datetime.now(timezone.utc)
    
    # 2. Forward to exchange to update actual limit/stop orders
    # For now, we'll rely on the exchange service to handle the "replacement" logic
    token = authorization.replace("Bearer ", "")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{EXCHANGE_SVC_URL}/exchange/order",
                json={
                    "user_id": str(order.user_id),
                    "symbol": order.symbol,
                    "side": 'sell' if order.side == 'buy' else 'buy',
                    "type": "limit", # TP is usually limit
                    "amount": 0, # The exchange service should handle "close all" or use the position/quantity
                    "quantity": order.quantity,
                    "price": tp,
                    "trade_type": order.trade_type,
                    "is_close": True,
                    "take_profit": tp,
                    "stop_loss": sl,
                },
                headers={"Authorization": f"Bearer {token}", "x-user-id": str(order.user_id)}
            )
    except Exception as e:
        logger.error(f"Syncing TP/SL update to exchange failed: {e}")

    db.commit()
    return {"message": "TP/SL updated", "take_profit": tp, "stop_loss": sl}


@app.get("/health")
async def health():
    return {"service": "orders", "status": "healthy"}
