"""
Auth Service — Manages user credentials (AES-encrypted API keys) and JWT tokens.
Security: AES-256 Fernet encryption, no withdrawal permission tolerance.
"""

import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests
from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import create_engine, Column, String, Text, DateTime
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.dialects.postgresql import UUID
from cryptography.fernet import Fernet, InvalidToken
from jose import JWTError, jwt
from pydantic import BaseModel, Field, validator
import uuid

logging.basicConfig(level=logging.INFO, format="%(asctime)s [AUTH] %(message)s")
logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────
DATABASE_URL      = os.getenv("DATABASE_URL", "postgresql://cryptotrader:CryptoSecure2024!@localhost:5432/cryptotrading")
ENCRYPTION_KEY    = os.getenv("ENCRYPTION_KEY", "").encode() or Fernet.generate_key()
JWT_SECRET        = os.getenv("JWT_SECRET_KEY", "change-this-in-production-32chars!!")
JWT_ALGO          = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_EXPIRE_MIN = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
REFRESH_EXPIRE_D  = int(os.getenv("JWT_REFRESH_TOKEN_EXPIRE_DAYS", "7"))
GOOGLE_CLIENT_ID  = os.getenv("GOOGLE_CLIENT_ID", "")

# Ensure a stable 32-byte Fernet key even if ENCRYPTION_KEY is not 44 chars base64
if ENCRYPTION_KEY and len(ENCRYPTION_KEY) == 44:
    fernet_key = ENCRYPTION_KEY
else:
    import hashlib, base64
    # Hash whatever we have to 32 bytes and base64 encode it to 44 chars
    hashed = hashlib.sha256(ENCRYPTION_KEY if ENCRYPTION_KEY else b"default-unsafe-key").digest()
    fernet_key = base64.urlsafe_b64encode(hashed)
    if not ENCRYPTION_KEY:
        logger.warning("No ENCRYPTION_KEY found in environment! Using a deterministic default (UNSAFE).")

fernet = Fernet(fernet_key)

# ──────────────────────────────────────────────
# Database
# ──────────────────────────────────────────────
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "user_profiles"
    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email      = Column(String(255), unique=True, nullable=False)
    name       = Column(String(255), nullable=True)
    google_id  = Column(String(255), unique=True, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class ExchangeAccount(Base):
    __tablename__ = "exchange_accounts"
    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id             = Column(UUID(as_uuid=True), nullable=True) # Linked to User.id
    exchange            = Column(String(50), nullable=False)
    api_key_encrypted   = Column(Text, nullable=False)
    api_secret_encrypted = Column(Text, nullable=False)
    label               = Column(String(100))
    created_at          = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at          = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ──────────────────────────────────────────────
# Encryption helpers
# ──────────────────────────────────────────────
def encrypt(value: str) -> str:
    return fernet.encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    try:
        return fernet.decrypt(value.encode()).decode()
    except InvalidToken:
        raise HTTPException(status_code=500, detail="Decryption failed — check ENCRYPTION_KEY")


# ──────────────────────────────────────────────
# JWT helpers
# ──────────────────────────────────────────────
def create_access_token(user_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_EXPIRE_MIN)
    return jwt.encode({"sub": user_id, "exp": exp, "type": "access"}, JWT_SECRET, algorithm=JWT_ALGO)


def create_refresh_token(user_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=REFRESH_EXPIRE_D)
    return jwt.encode({"sub": user_id, "exp": exp, "type": "refresh"}, JWT_SECRET, algorithm=JWT_ALGO)


def verify_token(token: str) -> str:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        user_id: str = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        return user_id
    except JWTError as e:
        logger.warning(f"JWT Verification failed: {e}")
        raise HTTPException(status_code=401, detail=f"Token error: {e}")


security = HTTPBearer(auto_error=False)


def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> str:
    if not credentials:
        raise HTTPException(status_code=401, detail="Bearer token required")
    return verify_token(credentials.credentials)


# ──────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────
ALLOWED_EXCHANGES = ["hyperliquid", "binance", "bybit", "okx", "kucoin", "coinbase"]

FORBIDDEN_PERMISSIONS = ["withdraw", "withdrawal", "transfer", "send"]


class ConnectExchangeRequest(BaseModel):
    exchange: str = Field(..., description="Exchange name")
    api_key: str  = Field(..., min_length=10, max_length=500)
    api_secret: str = Field(..., min_length=10, max_length=500)
    label: Optional[str] = Field(None, max_length=100)

    @validator("exchange")
    def validate_exchange(cls, v):
        v = v.lower().strip()
        if v not in ALLOWED_EXCHANGES:
            raise ValueError(f"Unsupported exchange. Allowed: {ALLOWED_EXCHANGES}")
        return v

    @validator("api_key", "api_secret")
    def no_whitespace(cls, v):
        if " " in v or "\n" in v:
            raise ValueError("API key/secret must not contain whitespace")
        return v


class GoogleLoginRequest(BaseModel):
    credential: str  # Google ID token from frontend


class ConnectResponse(BaseModel):
    user_id: str
    exchange: str
    label: Optional[str]
    access_token: str
    refresh_token: str
    message: str


class AccountResponse(BaseModel):
    id: str
    exchange: str
    label: Optional[str]
    created_at: str


class TokenRefreshRequest(BaseModel):
    refresh_token: str


class KeysResponse(BaseModel):
    user_id: str
    exchange: str
    api_key: str
    api_secret: str


# ──────────────────────────────────────────────
# App
# ──────────────────────────────────────────────
app = FastAPI(title="Auth Service", version="1.0.0", docs_url="/auth/docs")

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN, "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────
@app.post("/auth/google")
async def google_login(req: GoogleLoginRequest, db: Session = Depends(get_db)):
    """Verify Google ID token and create/return user."""
    try:
        idinfo = google_id_token.verify_oauth2_token(
            req.credential,
            google_requests.Request(),
            GOOGLE_CLIENT_ID
        )
    except ValueError as e:
        logger.error(f"Google token verification failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid Google token")

    email = idinfo.get("email")
    name = idinfo.get("name", "")
    google_id = idinfo.get("sub")

    if not email:
        raise HTTPException(status_code=400, detail="Email not found in Google token")

    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(email=email, name=name, google_id=google_id)
        db.add(user)
        db.commit()
        db.refresh(user)
    elif not user.google_id:
        user.google_id = google_id
        user.name = name or user.name
        db.commit()

    user_id = str(user.id)
    
    # Check if user has connected exchange
    has_exchange = db.query(ExchangeAccount).filter(
        ExchangeAccount.user_id == user_id
    ).first() is not None

    return {
        "user_id": user_id,
        "email": user.email,
        "name": user.name,
        "access_token": create_access_token(user_id),
        "refresh_token": create_refresh_token(user_id),
        "connected": has_exchange,
    }


@app.post("/auth/connect", response_model=ConnectResponse)
async def connect_exchange(
    req: ConnectExchangeRequest, 
    db: Session = Depends(get_db),
    current_user_id: Optional[str] = Depends(get_current_user)
):
    """
    Encrypt and store API keys. Links to a persistent User if logged in.
    """
    # Check for forbidden keywords in key/secret (basic safety)
    for forbidden in FORBIDDEN_PERMISSIONS:
        if forbidden in req.api_key.lower() or forbidden in req.api_secret.lower():
            raise HTTPException(status_code=400, detail="Key appears to contain forbidden permission scope")

    # If no user_id passed, we create a 'phantom' user for this connection (legacy support)
    if not current_user_id:
        phantom_email = f"phantom_{uuid.uuid4().hex[:8]}@local"
        user = User(email=phantom_email)
        db.add(user)
        db.commit()
        db.refresh(user)
        current_user_id = str(user.id)

    # Encrypt keys
    encrypted_key    = encrypt(req.api_key)
    encrypted_secret = encrypt(req.api_secret)

    # Check if this user already has this same label connected
    from sqlalchemy import func
    label_norm = req.label.strip().lower()
    existing_acc = db.query(ExchangeAccount).filter(
        ExchangeAccount.user_id == uuid.UUID(current_user_id),
        func.lower(ExchangeAccount.label) == label_norm
    ).first()

    if existing_acc:
        logger.info(f"Updating existing account {existing_acc.id}")
        existing_acc.api_key_encrypted = encrypted_key
        existing_acc.api_secret_encrypted = encrypted_secret
        acc = existing_acc
    else:
        logger.info(f"Linking NEW exchange account to user {current_user_id}")
        acc = ExchangeAccount(
            user_id=uuid.UUID(current_user_id),
            exchange=req.exchange,
            api_key_encrypted=encrypted_key,
            api_secret_encrypted=encrypted_secret,
            label=req.label,
        )
        db.add(acc)

    db.commit()
    db.refresh(acc)

    return ConnectResponse(
        user_id=current_user_id,
        exchange=acc.exchange,
        label=acc.label,
        access_token=create_access_token(current_user_id),
        refresh_token=create_refresh_token(current_user_id),
        message="Exchange connected successfully.",
    )


@app.post("/auth/refresh")
async def refresh_token(req: TokenRefreshRequest):
    """Issue a new access token using a valid refresh token."""
    user_id = verify_token(req.refresh_token)
    return {"access_token": create_access_token(user_id), "token_type": "bearer"}


@app.get("/auth/keys/{user_id}", response_model=KeysResponse)
async def get_keys(user_id: str, db: Session = Depends(get_db), current_user: str = Depends(get_current_user)):
    """Internal endpoint — retrieve decrypted keys (only accessible with valid JWT)."""
    if current_user != user_id:
        raise HTTPException(status_code=403, detail="Cannot access another user's keys")

    acc = db.query(ExchangeAccount).filter(ExchangeAccount.user_id == uuid.UUID(user_id)).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Exchange account not found")

    return KeysResponse(
        user_id=user_id,
        exchange=acc.exchange,
        api_key=decrypt(acc.api_key_encrypted),
        api_secret=decrypt(acc.api_secret_encrypted),
    )


@app.get("/auth/me")
async def get_me(current_user: str = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get current user profile (no key exposure)."""
    user = db.query(User).filter(User.id == uuid.UUID(current_user)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User profile not found")
    
    acc = db.query(ExchangeAccount).filter(ExchangeAccount.user_id == user.id).first()

    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "exchange": acc.exchange if acc else None,
        "label": acc.label if acc else None,
        "connected": acc is not None
    }


@app.get("/auth/accounts", response_model=list[AccountResponse])
async def get_accounts(current_user: str = Depends(get_current_user), db: Session = Depends(get_db)):
    """List all exchange connections for the user."""
    accounts = db.query(ExchangeAccount).filter(ExchangeAccount.user_id == uuid.UUID(current_user)).all()
    return [
        {
            "id": str(a.id),
            "exchange": a.exchange,
            "label": a.label,
            "created_at": a.created_at.isoformat()
        }
        for a in accounts
    ]


@app.delete("/auth/disconnect/{user_id}")
async def disconnect(user_id: str, db: Session = Depends(get_db), current_user: str = Depends(get_current_user)):
    """Remove stored credentials."""
    if current_user != user_id:
        raise HTTPException(status_code=403, detail="Cannot delete another user's account")
    user_acc = db.query(ExchangeAccount).filter(ExchangeAccount.user_id == uuid.UUID(user_id)).first()
    if not user_acc:
        raise HTTPException(status_code=404, detail="Exchange connection not found")
    db.delete(user_acc)
    db.commit()
    logger.info(f"User {user_id} disconnected and keys deleted")
    return {"message": "Credentials removed successfully"}


@app.get("/health")
async def health():
    return {"service": "auth", "status": "healthy"}
