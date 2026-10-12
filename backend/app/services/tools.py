from sqlalchemy.orm import Session

from app.knowledge import loader
from app.models import Call, ExchangeEnquiry, Lead, ServiceAppointment, TestDrive
from app.services.events import emit_rsa_confirmed
from app.services.lead_score import score_lead

# Demo fix near DLF Cyber City, Gurugram. One publish per call.
DEMO_GPS = "28.4951, 77.0894"
_rsa_published: set[int] = set()


def _s(value) -> str | None:
    return str(value).strip() if value not in (None, "") else None


async def _create_lead(db: Session, call_id: int, args: dict) -> str:
    lead = Lead(
        call_id=call_id,
        name=_s(args.get("name")),
        phone=_s(args.get("phone")),
        email=_s(args.get("email")),
        budget=_s(args.get("budget")),
        preferred_model=_s(args.get("preferred_model")),
        fuel_type=_s(args.get("fuel_type")),
        transmission=_s(args.get("transmission")),
        passengers=_s(args.get("passengers")),
        timeline=_s(args.get("timeline")),
        notes=_s(args.get("notes")),
    )
    score, reasons = score_lead(args)
    lead.score = score
    lead.score_reasons = "; ".join(reasons)
    db.add(lead)
    db.commit()
    return f"Lead created (id {lead.id}) with score {score}."


async def _book_test_drive(db: Session, call_id: int, args: dict) -> str:
    lead = db.query(Lead).filter(Lead.call_id == call_id).order_by(Lead.id.desc()).first()
    td = TestDrive(
        call_id=call_id,
        lead_id=lead.id if lead else None,
        model=_s(args.get("model")),
        name=_s(args.get("name")),
        phone=_s(args.get("phone")),
        preferred_date=_s(args.get("preferred_date")),
        preferred_time=_s(args.get("preferred_time")),
    )
    db.add(td)
    db.commit()
    return f"Test drive requested for {td.model or 'the selected model'} on {td.preferred_date} at {td.preferred_time}."


async def _schedule_service(db: Session, call_id: int, args: dict) -> str:
    sa = ServiceAppointment(
        call_id=call_id,
        customer_name=_s(args.get("customer_name")),
        phone=_s(args.get("phone")),
        vehicle_model=_s(args.get("vehicle_model")),
        registration_number=_s(args.get("registration_number")),
        service_requirement=_s(args.get("service_requirement")),
        preferred_time=_s(args.get("preferred_time")),
    )
    db.add(sa)
    db.commit()
    return f"Service appointment requested for {sa.vehicle_model or 'the vehicle'} at {sa.preferred_time}."


async def _create_exchange(db: Session, call_id: int, args: dict) -> str:
    ex = ExchangeEnquiry(
        call_id=call_id,
        customer_name=_s(args.get("customer_name")),
        phone=_s(args.get("phone")),
        vehicle_make=_s(args.get("vehicle_make")),
        vehicle_model=_s(args.get("vehicle_model")),
        year=_s(args.get("year")),
        variant=_s(args.get("variant")),
        km=_s(args.get("km")),
        condition=_s(args.get("condition")),
    )
    db.add(ex)
    db.commit()
    return f"Exchange enquiry created for {ex.vehicle_make or ''} {ex.vehicle_model or ''} ({ex.year or 'n/a'})."


async def _request_handoff(db: Session, call_id: int, args: dict) -> str:
    reason = _s(args.get("reason")) or "customer request"
    return f"Human handoff requested: {reason}. A sales executive should take over the call."


async def _get_current_gps_location(db: Session, call_id: int, args: dict) -> str:
    """Mock handset location for the roadside-assistance demo."""
    call = db.get(Call, call_id)
    call_sid = call.call_sid if call is not None else str(call_id)
    caller_number = (call.from_number if call is not None else None) or ""
    if call_id not in _rsa_published:
        _rsa_published.add(call_id)
        emit_rsa_confirmed(call_sid, DEMO_GPS, caller_number)
    return (
        f"GPS captured: {DEMO_GPS}, near DLF Cyber City, Gurugram. "
        "Roadside assistance is confirmed. Tell the caller calmly that a "
        "technician is being dispatched to that exact location, and do not "
        "ask them to describe where they are again."
    )


async def _check_vehicle_inventory(db: Session, call_id: int, args: dict) -> str:
    """Demo stock check. Returns availability only, never a rupee price."""
    raw = (_s(args.get("model_name")) or "").lower().replace("kia", "").strip()
    if not raw:
        names = ", ".join(loader.get_model_names())
        return f"Ask which model they mean. On the floor: {names}."
    if "ev9" in raw:
        return (
            "EV9 GT-Line is not in stock. The electric model available for a test drive is the "
            "EV6. Offer a test drive slot for the EV6 and mention its long electric range and "
            "ultra-fast charging. Do not quote a price."
        )
    if "ev6" in raw and "gt" in raw:
        return (
            "An EV6 GT demo car is not confirmed on the floor. The standard EV6 has 1 vehicle "
            "ready for a test drive. Offer that slot and say the team will confirm the GT. "
            "Do not quote a price."
        )
    match = None
    for name in loader.get_model_names():
        key = name.lower()
        if key in raw or raw in key:
            match = name
            break
    if match is None:
        names = ", ".join(loader.get_model_names())
        return (
            f"No inventory record for '{raw}'. Models on the floor: {names}. "
            "Ask which of these they want, then offer a test drive."
        )
    units = {"seltos": 4, "sonet": 3, "carens": 2, "syros": 2, "ev6": 1}.get(match.lower(), 1)
    plural = "vehicles" if units != 1 else "vehicle"
    return (
        f"{match} is in stock: {units} {plural} at the showroom, ready for a test drive. "
        "Do not quote an exact rupee price. Offer to book a test drive slot now."
    )


async def _get_model_details(db: Session, call_id: int, args: dict) -> str:
    name = _s(args.get("model_name")) or ""
    model = loader.get_model_details(name)
    if not model:
        names = ", ".join(loader.get_model_names())
        return f"Model '{name}' not found. Available models: {names}."
    return (
        f"{model['name']} — {model.get('body_type')}, {model.get('seating')} seats. "
        f"Fuel: {', '.join(model.get('fuel', []))}. Transmission: {', '.join(model.get('transmission', []))}. "
        f"Highlights: {', '.join(model.get('usps', []))}. Best for: {model.get('best_for', '')}."
    )


TOOL_DISPATCH = {
    "get_current_gps_location": _get_current_gps_location,
    "get_gps_location": _get_current_gps_location,
    "check_vehicle_inventory": _check_vehicle_inventory,
    "create_lead": _create_lead,
    "book_test_drive": _book_test_drive,
    "schedule_service": _schedule_service,
    "create_exchange_enquiry": _create_exchange,
    "request_human_handoff": _request_handoff,
    "get_model_details": _get_model_details,
}


TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "get_current_gps_location",
            "description": (
                "Read the caller's live GPS location during a roadside assistance call. "
                "Call this as soon as the caller reports a breakdown, accident, flat tyre, "
                "or asks for a tow. Do not use it for showroom visits, test drives, or "
                "routine service bookings."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_vehicle_inventory",
            "description": (
                "Check showroom availability for a vehicle model. Call this as soon as the "
                "caller names a model such as Seltos or EV9, or asks about availability "
                "or pricing. Do not use it for a breakdown or a service booking."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "model_name": {
                        "type": "string",
                        "description": "The model they asked about, e.g. Seltos or EV9",
                    }
                },
                "required": ["model_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_model_details",
            "description": "Get the exact specifications of a vehicle model from the knowledge base before recommending it.",
            "parameters": {
                "type": "object",
                "properties": {"model_name": {"type": "string", "description": "The model name, e.g. Seltos"}},
                "required": ["model_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_lead",
            "description": "Save a sales lead with the customer's details and requirements. Call this once you have collected the customer's details and qualification.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "phone": {"type": "string"},
                    "email": {"type": "string"},
                    "budget": {"type": "string"},
                    "preferred_model": {"type": "string"},
                    "fuel_type": {"type": "string"},
                    "transmission": {"type": "string"},
                    "passengers": {"type": "string"},
                    "timeline": {"type": "string"},
                    "notes": {"type": "string"},
                },
                "required": ["phone"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "book_test_drive",
            "description": "Book a test drive. Call this after collecting the model, name, phone, and preferred date and time.",
            "parameters": {
                "type": "object",
                "properties": {
                    "model": {"type": "string"},
                    "name": {"type": "string"},
                    "phone": {"type": "string"},
                    "preferred_date": {"type": "string"},
                    "preferred_time": {"type": "string"},
                },
                "required": ["model", "name", "phone", "preferred_date", "preferred_time"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "schedule_service",
            "description": "Schedule a service appointment. Call this after collecting vehicle model, registration number, service requirement, and preferred time.",
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_name": {"type": "string"},
                    "phone": {"type": "string"},
                    "vehicle_model": {"type": "string"},
                    "registration_number": {"type": "string"},
                    "service_requirement": {"type": "string"},
                    "preferred_time": {"type": "string"},
                },
                "required": ["vehicle_model", "registration_number", "service_requirement", "preferred_time"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_exchange_enquiry",
            "description": "Create an exchange enquiry for the customer's existing vehicle. Call this after collecting make, model, year, variant, kilometres, and condition.",
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_name": {"type": "string"},
                    "phone": {"type": "string"},
                    "vehicle_make": {"type": "string"},
                    "vehicle_model": {"type": "string"},
                    "year": {"type": "string"},
                    "variant": {"type": "string"},
                    "km": {"type": "string"},
                    "condition": {"type": "string"},
                },
                "required": ["vehicle_make", "vehicle_model"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_booking_state",
            "description": (
                "Save booking details as soon as the caller gives them. "
                "Call this whenever you learn the customer's name, the vehicle model they want, "
                "or the preferred test-drive time. Omit any field you do not know yet."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Customer name"},
                    "model": {"type": "string", "description": "Vehicle model, e.g. Seltos"},
                    "time": {"type": "string", "description": "Preferred date and time"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "request_human_handoff",
            "description": "Transfer to a human sales executive for price negotiation, complex queries, or when the customer asks for a person.",
            "parameters": {
                "type": "object",
                "properties": {"reason": {"type": "string"}},
                "required": ["reason"],
            },
        },
    },
]
