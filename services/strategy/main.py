"""
Strategy Service — Ladder strategy engine with APScheduler.
Executes orders sequentially based on % drop from last filled price.
"""

import os
import logging
import uuid
import asyncio
from datetime import datetime, timezone
from typing import Optional, List

import httpx
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, ForeignKey, Text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.dialects.postgresql import UUID
from pydantic import BaseModel, Field, validator
from apscheduler.schedulers.asyncio import AsyncIOScheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s [STRATEGY] %(message)s")
logger = logging.getLogger(__name__)

DATABASE_URL       = os.getenv("DATABASE_URL", "postgresql://cryptotrader:CryptoSecure2024!@localhost:5432/cryptotrading")
EXCHANGE_SVC_URL   = os.getenv("EXCHANGE_SERVICE_URL", "http://localhost:8002")
ORDER_SVC_URL      = os.getenv("ORDER_SERVICE_URL", "http://localhost:8004")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


class StrategyModel(Base):
    __tablename__ = "strategies"
    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id          = Column(UUID(as_uuid=True), nullable=False)
    symbol           = Column(String(20), nullable=False)
    base_price       = Column(Float, nullable=False)
    drop_percentage  = Column(Float, nullable=False)
    levels           = Column(Integer, nullable=False)
    amount_per_order = Column(Float, nullable=False)
    leverage         = Column(Integer, default=1)
    current_level    = Column(Integer, default=0)
    status           = Column(String(20), default="active")
    side             = Column(String(10), default="buy")
    order_type       = Column(String(20), default="futures")
    take_profit      = Column(Float, nullable=True)
    stop_loss        = Column(Float, nullable=True)
    last_filled_price = Column(Float, nullable=True)
    created_at       = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at       = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ──────────────────────────────────────────────
# Ladder Math
# ──────────────────────────────────────────────
def get_next_price(last_price: float, drop_percent: float) -> float:
    """Calculate next order price based on drop from last executed order price."""
    return round(last_price * (1 - drop_percent / 100), 8)


def calculate_all_levels(base_price: float, drop_pct: float, levels: int) -> List[dict]:
    """Generate all ladder levels from base price."""
    result = []
    price = base_price
    for i in range(1, levels + 1):
        result.append({"level": i, "price": round(price, 6)})
        price = get_next_price(price, drop_pct)
    return result


def calculate_liquidation_price(entry_price: float, leverage: int, side: str = "buy") -> float:
    """Approximate liquidation price."""
    if side == "buy":
        return round(entry_price * (1 - 1 / leverage), 2)
    else:
        return round(entry_price * (1 + 1 / leverage), 2)


# ──────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────
class CreateStrategyRequest(BaseModel):
    user_id: str
    symbol: str = Field(..., description="e.g. BTC/USDT:USDT")
    base_price: float = Field(..., gt=0, description="First order price")
    drop_percentage: float = Field(..., gt=0, le=50, description="% drop per level")
    levels: int = Field(..., ge=1, le=100)
    amount_per_order: float = Field(..., gt=0)
    leverage: int = Field(1, ge=1, le=125)
    side: str = Field("buy", pattern="^(buy|sell)$")
    order_type: str = Field("futures", pattern="^(spot|futures)$")
    take_profit: Optional[float] = None
    stop_loss: Optional[float] = None

    @validator("symbol")
    def upper_symbol(cls, v):
        return v.upper().strip()


class StrategyResponse(BaseModel):
    id: str
    user_id: str
    symbol: str
    base_price: float
    drop_percentage: float
    levels: int
    amount_per_order: float
    leverage: int
    current_level: int
    status: str
    side: str
    order_type: str
    take_profit: Optional[float]
    stop_loss: Optional[float]
    last_filled_price: Optional[float]
    ladder_preview: List[dict]
    created_at: str


# ──────────────────────────────────────────────
# Strategy Engine (Scheduler)
# ──────────────────────────────────────────────
scheduler = AsyncIOScheduler()


async def check_and_execute_strategy(strategy_id: str, auth_token: str):
    """
    Core ladder engine:
    1. Fetch current price from exchange
    2. Compare with next target level price
    3. Place next order if price <= target (for buy)
    4. Mark level as done, update current_level
    """
    db = SessionLocal()
    try:
        strategy = db.query(StrategyModel).filter(
            StrategyModel.id == uuid.UUID(strategy_id),
            StrategyModel.status == "active"
        ).first()

        if not strategy:
            return  # Strategy stopped or not found

        if strategy.current_level >= strategy.levels:
            strategy.status = "completed"
            db.commit()
            logger.info(f"Strategy {strategy_id} completed all {strategy.levels} levels")
            return

        # Determine last price (base_price for level 1, last_filled_price for subsequent)
        last_price = strategy.last_filled_price or strategy.base_price
        next_level = strategy.current_level + 1
        target_price = get_next_price(last_price, strategy.drop_percentage) if strategy.current_level > 0 else strategy.base_price

        # Fetch current market price
        async with httpx.AsyncClient(timeout=10.0) as client:
            symbol_path = strategy.symbol.replace("/", "-")
            resp = await client.get(
                f"{EXCHANGE_SVC_URL}/exchange/price/{symbol_path}",
                headers={
                    "Authorization": f"Bearer {auth_token}",
                    "x-user-id": str(strategy.user_id),
                }
            )
            if resp.status_code != 200:
                logger.warning(f"Price fetch failed for strategy {strategy_id}: {resp.text}")
                return

            current_price = resp.json()["price"]

        # Trigger logic
        triggered = False
        if strategy.side == "buy" and current_price <= target_price:
            triggered = True
        elif strategy.side == "sell" and current_price >= target_price:
            triggered = True

        if not triggered:
            return

        # Calculate quantity
        position_size = strategy.amount_per_order * strategy.leverage
        quantity = round(position_size / current_price, 6)

        logger.info(
            f"[Ladder] Strategy {strategy_id} | Level {next_level}/{strategy.levels} | "
            f"Target: {target_price} | Current: {current_price} | Qty: {quantity}"
        )

        # Place order via Order Service
        async with httpx.AsyncClient(timeout=15.0) as client:
            order_resp = await client.post(
                f"{ORDER_SVC_URL}/orders/place",
                json={
                    "user_id": str(strategy.user_id),
                    "strategy_id": strategy_id,
                    "symbol": strategy.symbol,
                    "level": next_level,
                    "price": target_price,
                    "amount": strategy.amount_per_order,
                    "quantity": quantity,
                    "leverage": strategy.leverage,
                    "side": strategy.side,
                    "order_type": "limit",
                    "trade_type": strategy.order_type,
                    "take_profit": strategy.take_profit,
                    "stop_loss": strategy.stop_loss,
                },
                headers={"Authorization": f"Bearer {auth_token}"}
            )

        if order_resp.status_code == 200:
            # Update strategy level
            strategy.current_level = next_level
            strategy.last_filled_price = target_price
            strategy.updated_at = datetime.now(timezone.utc)
            db.commit()
            logger.info(f"Strategy {strategy_id} advanced to level {next_level}")
        else:
            logger.error(f"Order placement failed for strategy {strategy_id}: {order_resp.text}")

    except Exception as e:
        logger.error(f"Strategy engine error for {strategy_id}: {e}")
    finally:
        db.close()


# ──────────────────────────────────────────────
# App
# ──────────────────────────────────────────────
app = FastAPI(title="Strategy Service", version="1.0.0", docs_url="/strategy/docs")

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN, "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store active scheduler jobs: {strategy_id: auth_token}
active_jobs: dict[str, str] = {}


@app.on_event("startup")
async def startup():
    scheduler.start()
    logger.info("Ladder strategy scheduler started")


@app.on_event("shutdown")
async def shutdown():
    scheduler.shutdown()


@app.post("/strategy/create", response_model=StrategyResponse)
async def create_strategy(
    req: CreateStrategyRequest,
    authorization: str = Header(...),
    db: Session = Depends(get_db)
):
    """Create and start a ladder strategy."""
    token = authorization.replace("Bearer ", "")

    strategy = StrategyModel(
        user_id=uuid.UUID(req.user_id),
        symbol=req.symbol,
        base_price=req.base_price,
        drop_percentage=req.drop_percentage,
        levels=req.levels,
        amount_per_order=req.amount_per_order,
        leverage=req.leverage,
        side=req.side,
        order_type=req.order_type,
        take_profit=req.take_profit,
        stop_loss=req.stop_loss,
        current_level=0,
        status="active",
    )
    db.add(strategy)
    db.commit()
    db.refresh(strategy)

    strategy_id = str(strategy.id)

    # Schedule polling job every 5 seconds
    scheduler.add_job(
        check_and_execute_strategy,
        "interval",
        seconds=5,
        id=strategy_id,
        args=[strategy_id, token],
        replace_existing=True,
        max_instances=1,
    )
    active_jobs[strategy_id] = token
    logger.info(f"Strategy created & scheduled: {strategy_id} — {req.symbol} {req.levels} levels {req.drop_percentage}% drop")

    preview = calculate_all_levels(req.base_price, req.drop_percentage, req.levels)
    return StrategyResponse(
        id=strategy_id,
        user_id=req.user_id,
        symbol=req.symbol,
        base_price=req.base_price,
        drop_percentage=req.drop_percentage,
        levels=req.levels,
        amount_per_order=req.amount_per_order,
        leverage=req.leverage,
        current_level=0,
        status="active",
        side=req.side,
        order_type=req.order_type,
        take_profit=req.take_profit,
        stop_loss=req.stop_loss,
        last_filled_price=None,
        ladder_preview=preview,
        created_at=strategy.created_at.isoformat(),
    )


@app.get("/strategy/{strategy_id}", response_model=StrategyResponse)
async def get_strategy(strategy_id: str, db: Session = Depends(get_db)):
    """Get strategy status, current level, and full ladder preview."""
    strategy = db.query(StrategyModel).filter(StrategyModel.id == uuid.UUID(strategy_id)).first()
    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")

    preview = calculate_all_levels(strategy.base_price, strategy.drop_percentage, strategy.levels)
    return StrategyResponse(
        id=str(strategy.id),
        user_id=str(strategy.user_id),
        symbol=strategy.symbol,
        base_price=strategy.base_price,
        drop_percentage=strategy.drop_percentage,
        levels=strategy.levels,
        amount_per_order=strategy.amount_per_order,
        leverage=strategy.leverage,
        current_level=strategy.current_level,
        status=strategy.status,
        side=strategy.side,
        order_type=strategy.order_type,
        take_profit=strategy.take_profit,
        stop_loss=strategy.stop_loss,
        last_filled_price=strategy.last_filled_price,
        ladder_preview=preview,
        created_at=strategy.created_at.isoformat(),
    )


@app.get("/strategy/user/{user_id}")
async def get_user_strategies(user_id: str, db: Session = Depends(get_db)):
    """Get all strategies for a user."""
    strategies = db.query(StrategyModel).filter(StrategyModel.user_id == uuid.UUID(user_id)).all()
    result = []
    for s in strategies:
        preview = calculate_all_levels(s.base_price, s.drop_percentage, s.levels)
        result.append({
            "id": str(s.id),
            "symbol": s.symbol,
            "drop_percentage": s.drop_percentage,
            "levels": s.levels,
            "current_level": s.current_level,
            "status": s.status,
            "last_filled_price": s.last_filled_price,
            "ladder_preview": preview[:5],  # Show first 5 levels in list
            "created_at": s.created_at.isoformat(),
        })
    return {"strategies": result}


@app.delete("/strategy/{strategy_id}")
async def stop_strategy(strategy_id: str, db: Session = Depends(get_db)):
    """Stop a running strategy."""
    strategy = db.query(StrategyModel).filter(StrategyModel.id == uuid.UUID(strategy_id)).first()
    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")

    strategy.status = "cancelled"
    strategy.updated_at = datetime.now(timezone.utc)
    db.commit()

    # Remove scheduler job
    if scheduler.get_job(strategy_id):
        scheduler.remove_job(strategy_id)
    active_jobs.pop(strategy_id, None)

    logger.info(f"Strategy {strategy_id} stopped")
    return {"message": "Strategy stopped successfully", "strategy_id": strategy_id}


@app.get("/strategy/preview/levels")
async def preview_levels(base_price: float, drop_pct: float, levels: int):
    """Calculate ladder levels without creating a strategy (for UI preview)."""
    if base_price <= 0 or drop_pct <= 0 or drop_pct > 50 or levels < 1 or levels > 100:
        raise HTTPException(status_code=400, detail="Invalid parameters")
    return {"levels": calculate_all_levels(base_price, drop_pct, levels)}


@app.get("/health")
async def health():
    return {
        "service": "strategy",
        "status": "healthy",
        "active_strategies": len(active_jobs),
        "scheduler_running": scheduler.running,
    }
