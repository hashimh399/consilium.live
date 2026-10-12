from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Voice LLM prefers Groq. DeepSeek is the streaming fallback when Groq is unset.
    groq_api_key: str = ""
    groq_api_keys: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_model: str = "openai/gpt-oss-20b"
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    llm_model: str = "deepseek-chat"

    # Deepgram stays on for speech-to-text. Speech-out uses Cartesia.
    deepgram_api_key: str = ""
    deepgram_stt_model: str = "nova-3"
    deepgram_tts_model: str = "aura-orion-en"

    # Cartesia Sonic. The key is read from CARTESIA_API_KEY.
    cartesia_api_key: str = ""
    cartesia_voice_id: str = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4"
    cartesia_tts_model: str = "sonic-3.6"

    # Twilio
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_phone_number: str = ""

    # App
    database_url: str = "sqlite:///./consilium_voice_agent.db"
    public_base_url: str = ""

    # Live events for the dashboard and the notification service.
    redis_url: str = "redis://127.0.0.1:6379"
    redis_channel: str = "voice_agent_events"

    # ANI directory. Queried once, before the greeting, when a call starts.
    caller_lookup_url: str = "http://localhost:8080/api/caller-lookup"


@lru_cache
def get_settings() -> Settings:
    return Settings()
