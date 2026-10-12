import logging
from xml.sax.saxutils import escape

from fastapi import APIRouter, Request, WebSocket
from fastapi.responses import Response
from starlette.websockets import WebSocketDisconnect

from app.config import get_settings
from app.services.telephony import CallSession

logger = logging.getLogger("voice_agent")

router = APIRouter()


@router.post("/voice/incoming")
async def voice_incoming(request: Request):
    form = await request.form()
    from_number = form.get("From", "")
    to_number = form.get("To", "")
    host = request.headers.get("host", "localhost")
    base = get_settings().public_base_url.rstrip("/") or f"https://{host}"
    stream_url = (
        base.replace("https://", "wss://").replace("http://", "ws://") + "/media-stream"
    )
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="{escape(stream_url)}">
      <Parameter name="from" value="{escape(from_number)}"/>
      <Parameter name="to" value="{escape(to_number)}"/>
    </Stream>
  </Connect>
</Response>"""
    logger.info("Incoming call webhook: from=%s to=%s", from_number, to_number)
    return Response(content=twiml, media_type="application/xml")


@router.websocket("/media-stream")
async def media_stream(ws: WebSocket):
    await ws.accept()
    session = CallSession(ws)
    try:
        await session.run()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("media_stream handler error")
    finally:
        await session.teardown()
