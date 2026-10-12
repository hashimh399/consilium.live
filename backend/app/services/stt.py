from urllib.parse import quote

from app.config import get_settings

KEYTERMS = "Sonet,Seltos,Carens,Syros,EV6,test drive,PAL Jay,Consilium,showroom,exchange,EMI,service"


def build_listen_url(encoding: str = "mulaw") -> str:
    """Streaming listen URL for 8 kHz mono phone audio.

    Nova-2 phonecall with a single language hears Hindi as English. Nova-3
    `language=multi` is the query Deepgram accepts for English and Hindi in
    one stream. A repeated `language=en&language=hi` query is rejected.
    """
    s = get_settings()
    model = s.deepgram_stt_model
    if model not in {"nova-3", "nova-3-general"}:
        model = "nova-3"
    params = {
        "model": model,
        "encoding": encoding,
        "sample_rate": "8000",
        "channels": "1",
        "language": "multi",
        "interim_results": "true",
        "smart_format": "true",
        "endpointing": "100",
        "vad_events": "true",
    }
    # `keyterm` is unsupported by the phonecall models and returns HTTP 400.
    if "phonecall" not in model:
        params["keyterm"] = KEYTERMS
    qs = "&".join(f"{k}={quote(str(v), safe=',')}" for k, v in params.items())
    return f"wss://api.deepgram.com/v1/listen?{qs}"


def auth_headers() -> dict:
    return {"Authorization": f"Token {get_settings().deepgram_api_key}"}


def parse_result(message: dict) -> tuple[str, bool]:
    """Extract (transcript, is_final) from a Deepgram Results message."""
    channel = message.get("channel") or {}
    alternatives = channel.get("alternatives") or []
    if not alternatives:
        return "", bool(message.get("is_final"))
    return alternatives[0].get("transcript", ""), bool(message.get("is_final"))
