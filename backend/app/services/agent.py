import json
import logging
import re
import uuid
from collections.abc import AsyncIterator
from datetime import datetime

import httpx
from sqlalchemy.orm import Session

from app.knowledge.loader import build_system_prompt
from app.services import tools
from app.services.llm import stream_chat

logger = logging.getLogger("voice_agent")

MAX_TOOL_ROUNDS = 3
MAX_CONTEXT_MESSAGES = 14
MIN_SENTENCE_CHARS = 28
# The Devanagari danda ends a Hindi sentence the way a full stop ends an English one.
_SENTENCE = re.compile(r"[.?!\u0964]|\n")


def _sentence_cut(buf: str) -> int | None:
    """Index after a `.` `?` `!` or newline once the chunk is long enough to speak."""
    start = 0
    while True:
        match = _SENTENCE.search(buf, start)
        if match is None:
            return None
        if len(buf[: match.end()].strip()) >= MIN_SENTENCE_CHARS:
            return match.end()
        start = match.end()


def _named_tool_calls(message: dict | None) -> list[dict]:
    """Keep only tool calls that have a function name. gpt-oss rejects the rest."""
    if not message:
        return []
    return [
        tc
        for tc in (message.get("tool_calls") or [])
        if (tc.get("function") or {}).get("name")
    ]


class _ClauseBuffer:
    """Release a chunk only at the end of a sentence."""

    def __init__(self) -> None:
        self._buf = ""

    def push(self, token: str) -> list[str]:
        self._buf += token
        ready: list[str] = []
        while True:
            cut = _sentence_cut(self._buf)
            if cut is None:
                break
            sentence = self._buf[:cut].strip()
            self._buf = self._buf[cut:]
            if sentence:
                ready.append(sentence)
        return ready

    def flush(self) -> str | None:
        tail = self._buf.strip()
        self._buf = ""
        return tail or None


def _profile_field(profile: dict, key: str, fallback: str) -> str:
    value = str(profile.get(key) or "").strip()
    if value.lower() in {"n/a", "na", "none", "null", "-"}:
        return fallback
    return value or fallback


def _session_context(profile: dict | None) -> str:
    """First instruction of the call. It overrides the generic identity below it."""
    name = _profile_field(profile, "name", "") if profile else ""
    if not name:
        return (
            "SYSTEM CONTEXT: You are a bi-lingual Consilium support agent, fluent in English, Hindi, and Hinglish. "
            "If the caller asks for Hindi or code-switches into Hinglish, reply in that language immediately. "
            "Proceed with standard supportive routing. "
            "The opening greeting already asked the caller to confirm the full name "
            "on the registration. Do not mention their vehicle, VIN, dealer, service "
            "history, or VIP status until they confirm that name. "
            "Exception: a breakdown, accident, or tow skips identity verification. "
            "Call get_current_gps_location first. "
            "This opening overrides the generic identity in the instructions that follow.\n\n"
        )
    tier = _profile_field(profile, "vip_status", "standard")
    vehicle = _profile_field(profile, "vehicle", "") or _profile_field(
        profile, "vehicle_owned", ""
    )
    vin = _profile_field(profile, "vin_last_4", "unknown")
    dealer = _profile_field(profile, "preferred_dealer", "their preferred dealer")
    last_service = _profile_field(profile, "last_service_date", "unknown")
    sentiment = _profile_field(profile, "last_sentiment_recorded", "unknown")
    ownership = _profile_field(profile, "ownership_type", "")
    notes = _profile_field(profile, "interest_notes", "")
    if ownership.upper() == "HOT LEAD" or not vehicle:
        interest = f" Interest on file: {notes}." if notes else ""
        return (
            "SYSTEM CONTEXT: You are a bi-lingual Consilium sales agent, fluent in English, Hindi, and Hinglish. "
            "If the caller asks for Hindi or code-switches into Hinglish, reply in that language immediately. "
            f"The caller is {name}, a {tier} lead"
            f"{f' ({ownership})' if ownership else ''} "
            f"at {dealer}.{interest} "
            "They do not have a vehicle or service history on file. "
            "Address them by name. Do not ask them to verify their identity. "
            "Do not invent a vehicle, VIN, or last service date. "
            "This session context is the first instruction for this call and overrides "
            "the generic identity in the instructions that follow.\n\n"
        )
    return (
        "SYSTEM CONTEXT: You are a calm and supportive bi-lingual Consilium Roadside Assistance agent, fluent in English, Hindi, and Hinglish. "
        "If the caller asks for Hindi or code-switches into Hinglish, stay calm and reply in that language immediately. "
        f"The caller is {name}, a {tier} tier customer. "
        f"They are driving a {vehicle} (VIN last 4: {vin}), "
        f"and their preferred dealer is {dealer}. "
        f"Their last service date was {last_service}. "
        f"Their last recorded sentiment was {sentiment}. "
        "Proceed with maximum de-escalation, addressing them by name. "
        "The opening greeting already welcomed them back and mentioned their last visit. "
        "Do not ask them to verify their identity or repeat their name. "
        "This session context is the first instruction for this call and overrides "
        "the generic identity in the instructions that follow.\n\n"
    )


_RSA_CUES = (
    "breakdown",
    "accident",
    "crash",
    "stranded",
    "tow",
    "flat tyre",
    "flat tire",
    "won't start",
    "wont start",
    # Hinglish and Hindi, as Deepgram writes them in Latin or Devanagari.
    "gaadi kharab",
    "gadi kharab",
    "gaadi band",
    "gadi band",
    "puncture",
    "एक्सीडेंट",
    "दुर्घटना",
    "गाड़ी खराब",
    "गाड़ी बंद",
    "पंक्चर",
    "ब्रेकडाउन",
    "टोइंग",
)
_INVENTORY_CUES = (
    "seltos",
    "sonet",
    "carens",
    "syros",
    "ev6",
    "ev9",
    "gt-line",
    "gt line",
    "ct line",
    "जीटी लाइन",
    "सीटी लाइन",
    "ईवी",
    "electric",
    "available",
    "availability",
    "in stock",
    "stock",
    "price",
    "pricing",
    "on-road",
    "on road",
    "kimat",
    "keemat",
    "daam",
    "सेल्टोस",
    "सोनेट",
    "कैरेंस",
    "स्टॉक",
    "उपलब्ध",
    "कीमत",
    "दाम",
    "इलेक्ट्रिक",
)
_SERVICE_CUES = (
    "service appointment",
    "book a service",
    "schedule a service",
    "maintenance",
    "oil change",
    "servicing",
    "service karwa",
    "service karani",
    "service karna",
    "सर्विस",
    "सर्विसिंग",
)
# Buying talk that names no model. Upbeat, never overrides roadside.
_SALES_CUES = (
    "new car",
    "new gaadi",
    "new gadi",
    "buy a car",
    "buy car",
    "buying",
    "purchase",
    "test drive",
    "test-drive",
    "testdrive",
    "showroom",
    "gaadi leni",
    "gadi leni",
    "gaadi lena",
    "gadi lena",
    "kharid",
    "नई गाड़ी",
    "नयी गाड़ी",
    "नई कार",
    "नयी कार",
    "गाड़ी लेनी",
    "गाड़ी लेना",
    "कार लेनी",
    "कार लेना",
    "खरीद",
    "टेस्ट ड्राइव",
    "टेस्ट ड्राईव",
    "शोरूम",
)

# Spoken model numbers: "EV nine", "e v 6", "ईवी नाइन" all become ev9 or ev6.
_EV_SPOKEN = re.compile(
    r"(?:\bev|\be\.?\s?v\.?|ईवी|ई\s?वी)[\s\-]*"
    r"(six|nine|6|9|सिक्स|छह|छः|नाइन|नौ|६|९)(?![0-9])"
)
_EV_DIGIT = {
    "six": "6", "6": "6", "सिक्स": "6", "छह": "6", "छः": "6", "६": "6",
    "nine": "9", "9": "9", "नाइन": "9", "नौ": "9", "९": "9",
}
_EV_BARE = re.compile(r"\bev\b")


def _fold(text: str) -> str:
    """Lowercase, and turn spoken EV numbers into ev6 or ev9 so the cue lists match."""
    lowered = text.lower()
    return _EV_SPOKEN.sub(lambda m: "ev" + _EV_DIGIT[m.group(1)], lowered)


def _detect_intent(text: str) -> str | None:
    """Pick the persona for this turn before the model speaks."""
    lowered = _fold(text)
    if any(cue in lowered for cue in _RSA_CUES):
        return "rsa"
    # An explicit service request wins over a model name ("service for my Seltos").
    if any(cue in lowered for cue in _SERVICE_CUES):
        return "service"
    if any(cue in lowered for cue in _INVENTORY_CUES) or _EV_BARE.search(lowered):
        return "inventory"
    if any(cue in lowered for cue in _SALES_CUES):
        return "sales"
    return None


_GPS_TOOLS = {"get_current_gps_location", "get_gps_location"}

# Words that mark a new question, so a barge-in can be acknowledged first.
_TOPIC_CUES: dict[str, tuple[str, ...]] = {
    "stock": (
        "stock", "available", "availability", "milegi", "milega", "kitni gaadi",
        "स्टॉक", "उपलब्ध", "मिलेगी", "मिलेगा",
    ),
    "insurance": ("insurance", "bima", "बीमा", "इंश्योरेंस"),
    "price": (
        "price", "pricing", "on-road", "on road", "emi", "cost", "kitna", "kimat",
        "keemat", "daam", "कीमत", "दाम", "कितना", "कितने",
    ),
}

_MODEL_CUES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("EV9", ("ev9", "ev 9", "ईवी9", "ईवी 9", "gt-line", "gt line", "ct line", "जीटी लाइन", "सीटी लाइन")),
    ("EV6", ("ev6", "ev 6", "ईवी6", "ईवी 6")),
    ("Seltos", ("seltos", "सेल्टोस")),
    ("Sonet", ("sonet", "सोनेट")),
    ("Carens", ("carens", "कैरेंस")),
    ("Syros", ("syros", "सायरोस")),
)


def _barge_topics(text: str) -> list[str]:
    lowered = _fold(text)
    return [
        topic
        for topic, cues in _TOPIC_CUES.items()
        if any(cue in lowered for cue in cues)
    ]


def _requested_models(text: str, profile: dict | None) -> list[str]:
    """Models to check. The caller's words win, then what the CRM says they own or want."""
    lowered = _fold(text)
    named = [name for name, cues in _MODEL_CUES if any(cue in lowered for cue in cues)]
    if named:
        return named
    generic = bool(
        any(cue in lowered for cue in ("electric", "इलेक्ट्रिक", "ईवी")) or _EV_BARE.search(lowered)
    )
    asked = any(cue in lowered for cue in _INVENTORY_CUES)
    if not (asked or generic) or not profile:
        return []
    notes = str(profile.get("interest_notes") or "").lower()
    leaning = [name for name in ("EV6", "EV9") if name.lower() in notes]
    if leaning and (generic or str(profile.get("ownership_type") or "").upper() == "HOT LEAD"):
        return leaning
    owned = " ".join(
        str(profile.get(key) or "") for key in ("vehicle", "vehicle_owned")
    ).lower()
    for name, cues in _MODEL_CUES:
        if any(cue in owned for cue in cues):
            return [name]
    return leaning


def _barge_in_directive(text: str, previous_reply: str) -> str:
    topics = _barge_topics(text)
    cut = previous_reply.strip().replace("\n", " ")[:140]
    said = f' You were saying: "{cut}".' if cut else ""
    if topics:
        asked = ", ".join(topics)
        detail = (
            f"Their new message contains a distinct question about: {asked}. "
            "Acknowledge that question first, in one short sentence in their language. "
        )
    else:
        detail = (
            "Acknowledge what they just said first, in one short sentence in their language. "
        )
    return (
        "BARGE-IN: The caller interrupted your last reply."
        f"{said} {detail}"
        "Then answer it only from a tool result or the knowledge base. "
        "Stock: use the check_vehicle_inventory result. "
        "Price: never say a rupee figure. Offer the sales team. "
        "Insurance: no policy or premium is on file. Do not invent one. "
        "Offer a callback from the PAL Jay team. "
        "After the answer, return to the step you were on: roadside means confirm the "
        "dispatch, sales means the test drive slot, service means the missing booking detail. "
        "Do not repeat what you already said.\n\n"
    )


def _intent_for_tool(name: str) -> str | None:
    if name in _GPS_TOOLS:
        return "rsa"
    if name == "check_vehicle_inventory":
        return "inventory"
    if name == "schedule_service":
        return "service"
    if name in ("book_test_drive", "create_lead"):
        return "sales"
    return None


RSA_STYLE = (
    "DELIVERY STYLE: Calm and Supportive. Speak slowly, in short soft sentences, in the "
    "caller's own mix of Hindi and English. First de-escalate: say you are with them and "
    "help is on the way. Then confirm safety: are they and everyone in the car unhurt, "
    "and is the car off the road with hazard lights on. Natural Hinglish, for example "
    "'Aap ghabraiye mat, main aapke saath hoon. Kya aap sab theek hain?' "
    "Never joke, never sell, never hurry the caller."
)
SALES_STYLE = (
    "DELIVERY STYLE: Upbeat and Energetic. Sound happy to help, in short lively sentences, "
    "in the caller's own mix of Hindi and English. For EV6 and EV9 enquiries, lead with "
    "what the knowledge base lists: long electric range, ultra-fast charging, premium "
    "performance, flagship electric SUV. Do not invent a range figure or a price. "
    "Natural Hinglish, for example 'Bahut badhiya choice hai! EV6 abhi showroom par test "
    "drive ke liye ready hai.' Always close by booking a test drive slot."
)


def _intent_directive(intent: str | None) -> str:
    if intent == "rsa":
        return (
            "ACTIVE INTENT: Roadside assistance. Persona: Calm and Supportive, bi-lingual in "
            "English, Hindi, and Hinglish. If the caller uses Hindi or Hinglish, answer in that "
            "same language. "
            "The GPS lookup has already run for this call, so use its coordinates and do not "
            "ask where the caller is. Confirm the location before any identity verification. "
            f"{RSA_STYLE}\n\n"
        )
    if intent == "inventory":
        return (
            "ACTIVE INTENT: Inventory request. Persona: Upbeat and Energetic, bi-lingual in "
            "English, Hindi, and Hinglish. If the caller uses Hindi or Hinglish, answer in that "
            "same language. "
            "The inventory check has already run for the requested model, so speak only that "
            "availability. Then offer to book a test drive slot. "
            f"{SALES_STYLE}\n\n"
        )
    if intent == "sales":
        return (
            "ACTIVE INTENT: New car sales enquiry. Persona: Upbeat and Energetic, bi-lingual in "
            "English, Hindi, and Hinglish. If the caller uses Hindi or Hinglish, answer in that "
            "same language. "
            "Ask which model they have in mind, or suggest the EV6 or EV9 if they lean electric. "
            "Use check_vehicle_inventory only for a model they name. "
            "Do not invent a price or a range figure. Then offer a test drive slot, and only call "
            "book_test_drive once they give a day and time. "
            f"{SALES_STYLE}\n\n"
        )
    if intent == "service":
        return (
            "ACTIVE INTENT: Service booking. Persona: practical and concise. "
            "Use schedule_service once you have the vehicle, registration, "
            "requirement, and preferred time.\n\n"
        )
    return ""


class CallAgent:
    """Holds per-call conversation state and runs the LLM tool-calling loop."""

    def __init__(self, db: Session, call_id: int, caller_number: str | None = None):
        self.db = db
        self.call_id = call_id
        self.handed_off = False
        self.call_state = {"name": "Unknown", "model": "Unknown", "time": "Unknown"}
        self.caller_profile: dict | None = None
        self.active_intent: str | None = None
        self.side_question = False
        self.turn = 0
        self._gps_done = False
        self._inventory_checked: set[str] = set()
        self._barge_pending = False
        self._barge_directive = ""
        self.running_summary = "No previous context."
        today = datetime.now().strftime("%A, %B %d, %Y")
        self._base_prompt = build_system_prompt()
        self._base_prompt += f"\n\nToday's date is {today}."
        if caller_number:
            self._base_prompt += (
                f"\n\nThe caller's phone number is {caller_number}. "
                "Use this number when capturing contact details; do not ask the caller for it again."
            )
        self.messages: list[dict] = [
            {"role": "system", "content": ""},
        ]
        self._refresh_system_prompt()

    def set_caller_profile(self, profile: dict | None) -> None:
        """Install the ANI directory result as the opening of the system prompt."""
        self.caller_profile = profile or None
        if profile:
            name = str(profile.get("name") or "").strip()
            vehicle = str(
                profile.get("vehicle") or profile.get("vehicle_owned") or ""
            ).strip()
            if name:
                self.call_state["name"] = name
            if vehicle and vehicle.lower() not in {"n/a", "na", "none", "null", "-"}:
                self.call_state["model"] = vehicle
        self._refresh_system_prompt()

    def note_barge_in(self) -> None:
        """The caller spoke over the agent. The next turn must acknowledge the new question."""
        self._barge_pending = True

    def _last_agent_reply(self) -> str:
        for message in reversed(self.messages):
            if message.get("role") == "assistant" and (message.get("content") or "").strip():
                return message["content"]
        return ""

    def _allowed_tools(self) -> list[dict]:
        """Only the tools the validated intent permits. Anything else is withheld."""
        intent = self.active_intent
        blocked: set[str] = set(_GPS_TOOLS) | {"check_vehicle_inventory"}
        if intent == "rsa":
            if not self._gps_done:
                blocked -= _GPS_TOOLS
            if self.side_question:
                blocked.discard("check_vehicle_inventory")
        elif intent in ("inventory", "sales"):
            blocked.discard("check_vehicle_inventory")
        return [t for t in tools.TOOLS if t["function"]["name"] not in blocked]

    def _inject_tool_call(self, name: str, args: dict, result: str) -> None:
        """Record a tool call the dialogue manager made itself, in the model's own format."""
        call_id = f"call_{uuid.uuid4().hex[:12]}"
        self.messages.append(
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": call_id,
                        "type": "function",
                        "function": {"name": name, "arguments": json.dumps(args)},
                    }
                ],
            }
        )
        self.messages.append(
            {"role": "tool", "tool_call_id": call_id, "name": name, "content": result}
        )

    async def prepare_turn(self, user_text: str) -> None:
        """Validate the intent, then run its required tool before the model speaks.

        Roadside always reads GPS once. Inventory always checks each requested
        model once. The model then only has to speak what the tool returned.
        """
        self.turn += 1
        self.messages.append({"role": "user", "content": user_text})
        detected = _detect_intent(user_text)
        self.side_question = False
        if detected is not None:
            if self.active_intent == "rsa" and detected in ("inventory", "sales"):
                # A stock or buying question during a breakdown stays calm. Roadside resumes after.
                self.side_question = detected == "inventory"
            elif detected == "sales" and self.active_intent == "inventory":
                pass  # already in the upbeat sales flow, keep the more specific step
            else:
                self.active_intent = detected

        if self._barge_pending:
            self._barge_directive = _barge_in_directive(user_text, self._last_agent_reply())
            self._barge_pending = False
        else:
            self._barge_directive = ""

        if self.active_intent == "rsa" and detected == "rsa" and not self._gps_done:
            await self._run_required("get_current_gps_location", {})
            self._gps_done = True
        if detected == "inventory":
            for model in _requested_models(user_text, self.caller_profile):
                if model in self._inventory_checked:
                    continue
                self._inventory_checked.add(model)
                await self._run_required("check_vehicle_inventory", {"model_name": model})

        logger.info(
            "Turn %d intent=%s side_question=%s barge_in=%s tools=%s",
            self.turn,
            self.active_intent,
            self.side_question,
            bool(self._barge_directive),
            [t["function"]["name"] for t in self._allowed_tools()],
        )
        self._refresh_system_prompt()

    async def _run_required(self, name: str, args: dict) -> None:
        handler = tools.TOOL_DISPATCH[name]
        try:
            result = await handler(self.db, self.call_id, args)
        except Exception as exc:  # the call stays up if a demo tool fails
            result = f"Tool {name} failed: {exc}"
        logger.info("Required tool %s executed for turn %d", name, self.turn)
        self._inject_tool_call(name, args, result)

    async def respond(
        self,
        user_text: str,
        http_client: httpx.AsyncClient | None = None,
        prepared: bool = False,
    ) -> AsyncIterator[str]:
        """Yield each finished sentence as the model streams it.

        Chunks are released on `.`, `?`, `!`, or a newline once they are at least
        28 characters. Shorter lead-ins stay attached to the next sentence.
        """
        if not prepared:
            await self.prepare_turn(user_text)
        await self._trim_history()
        self.handed_off = False

        for _ in range(MAX_TOOL_ROUNDS):
            message = None
            buffer = _ClauseBuffer()
            async for event in stream_chat(
                self.messages, tools=self._allowed_tools(), http_client=http_client
            ):
                if event["kind"] == "text":
                    for clause in buffer.push(event["text"]):
                        yield clause
                else:
                    message = event["message"]
            tail = buffer.flush()
            if tail:
                yield tail
            named_calls = _named_tool_calls(message)
            if message is None or not named_calls:
                self.messages.append(
                    {"role": "assistant", "content": (message or {}).get("content") or ""}
                )
                return

            message = {**message, "tool_calls": named_calls}
            self.messages.append(message)
            await self._run_tools(message)

        buffer = _ClauseBuffer()
        message = None
        await self._trim_history()
        async for event in stream_chat(self.messages, tools=None, http_client=http_client):
            if event["kind"] == "text":
                for clause in buffer.push(event["text"]):
                    yield clause
            else:
                message = event["message"]
        tail = buffer.flush()
        if tail:
            yield tail
        self.messages.append(
            {"role": "assistant", "content": (message or {}).get("content") or ""}
        )

    async def _run_tools(self, message: dict) -> None:
        for tc in message["tool_calls"]:
            name = tc["function"]["name"]
            if name == "request_human_handoff":
                self.handed_off = True
            try:
                args = json.loads(tc["function"]["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            allowed = {t["function"]["name"] for t in self._allowed_tools()}
            if name in (_GPS_TOOLS | {"check_vehicle_inventory"}) and name not in allowed:
                logger.warning("Blocked %s: not valid for intent %s", name, self.active_intent)
                self.messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "name": name,
                        "content": (
                            f"{name} is not valid for this request. The required check "
                            "has already run. Use the earlier result and answer."
                        ),
                    }
                )
                continue
            if name in _GPS_TOOLS:
                self._gps_done = True
            intent = _intent_for_tool(name)
            keep_rsa = self.active_intent == "rsa" and intent in ("inventory", "sales")
            keep_inventory = self.active_intent == "inventory" and intent == "sales"
            if intent is not None and not (
                (self.side_question and intent == "inventory") or keep_rsa or keep_inventory
            ):
                self.active_intent = intent
                self._refresh_system_prompt()
            if name == "update_booking_state":
                result = self.update_booking_state(args)
            else:
                handler = tools.TOOL_DISPATCH.get(name)
                if handler is None:
                    result = f"Unknown tool: {name}"
                else:
                    try:
                        result = await handler(self.db, self.call_id, args)
                    except Exception as exc:  # keep the conversation alive on tool errors
                        result = f"Tool {name} failed: {exc}"
            self.messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "name": name,
                    "content": result,
                }
            )

    def update_booking_state(self, args: dict) -> str:
        """Save name, model, or time as soon as the caller provides them."""
        for key in ("name", "model", "time"):
            value = args.get(key)
            if value is None:
                continue
            text = str(value).strip()
            if text and text.lower() != "unknown":
                self.call_state[key] = text
        self._refresh_system_prompt()
        return f"Booking state saved: {self.call_state}."

    def _pop_oldest_pair(self) -> tuple[str, str] | None:
        """Drop the oldest complete turn, stopping at the next user message.

        The turn includes the tool-call assistant message, tool results, and the
        spoken reply. The two most recent user turns are left in place.
        """
        user_indexes = [
            index
            for index, message in enumerate(self.messages)
            if index > 0 and message.get("role") == "user"
        ]
        if len(user_indexes) <= 2:
            return None
        user_idx = user_indexes[0]
        end = user_indexes[1]
        user_msg = self.messages[user_idx].get("content") or ""
        ai_msg = ""
        for message in self.messages[user_idx + 1 : end]:
            if message.get("role") != "assistant":
                continue
            content = (message.get("content") or "").strip()
            if content:
                ai_msg = content
                continue
            if ai_msg:
                continue
            names = [
                (tc.get("function") or {}).get("name") or ""
                for tc in (message.get("tool_calls") or [])
            ]
            called = ", ".join(name for name in names if name)
            if called:
                ai_msg = f"Called {called}."
        del self.messages[user_idx:end]
        return user_msg, ai_msg

    def _refresh_system_prompt(self) -> None:
        """Rewrite the system message. Session context is always the first text."""
        self.messages[0]["content"] = (
            f"{_session_context(self.caller_profile)}"
            f"{_intent_directive(self.active_intent)}"
            f"{self._barge_directive}"
            f"{self._base_prompt}\n\n"
            f"CURRENT CALL STATE: {self.call_state}. "
            "Do not ask for information already listed here.\n"
            f"BACKGROUND MEMORY: {self.running_summary}"
        )

    async def _trim_history(self) -> None:
        """Keep at most 14 messages by folding the oldest complete turn into memory."""
        while len(self.messages) > MAX_CONTEXT_MESSAGES:
            pair = self._pop_oldest_pair()
            if pair is None:
                break
            user_msg, ai_msg = pair
            fragment = f"User: {user_msg} -> AI: {ai_msg}"
            if self.running_summary == "No previous context.":
                self.running_summary = fragment
            else:
                self.running_summary += f" | {fragment}"
        self._refresh_system_prompt()
