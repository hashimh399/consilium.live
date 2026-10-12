import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)

from app.config import get_settings
from app.db import Base, engine
from app.routers import dashboard, mock_dms, voice


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Consilium Voice Agent", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(voice.router)
app.include_router(dashboard.router)
app.include_router(mock_dms.router)


@app.get("/health")
async def health():
    s = get_settings()
    return {
        "status": "ok",
        "groq": bool(s.groq_api_key or s.groq_api_keys.strip()),
        "groq_keys": len(
            {k.strip() for k in s.groq_api_keys.split(",") if k.strip()}
            | ({s.groq_api_key.strip()} if s.groq_api_key.strip() else set())
        ),
        "deepseek": bool(s.deepseek_api_key),
        "deepgram": bool(s.deepgram_api_key),
        "twilio": bool(s.twilio_account_sid and s.twilio_auth_token),
    }
