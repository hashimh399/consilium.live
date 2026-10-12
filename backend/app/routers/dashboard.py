from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Call, ExchangeEnquiry, Lead, Message, ServiceAppointment, TestDrive

router = APIRouter(prefix="/api")


def _iso(dt):
    return dt.isoformat() if dt else None


def call_dict(call: Call) -> dict:
    return {
        "id": call.id,
        "call_sid": call.call_sid,
        "from_number": call.from_number,
        "to_number": call.to_number,
        "status": call.status,
        "intent": call.intent,
        "summary": call.summary,
        "lead_score": call.lead_score,
        "next_action": call.next_action,
        "handed_off": call.handed_off,
        "started_at": _iso(call.started_at),
        "ended_at": _iso(call.ended_at),
    }


def message_dict(m: Message) -> dict:
    return {"id": m.id, "role": m.role, "content": m.content, "created_at": _iso(m.created_at)}


def lead_dict(l: Lead) -> dict:
    return {
        "id": l.id,
        "call_id": l.call_id,
        "name": l.name,
        "phone": l.phone,
        "email": l.email,
        "budget": l.budget,
        "preferred_model": l.preferred_model,
        "fuel_type": l.fuel_type,
        "transmission": l.transmission,
        "passengers": l.passengers,
        "timeline": l.timeline,
        "recommended_model": l.recommended_model,
        "notes": l.notes,
        "score": l.score,
        "score_reasons": l.score_reasons,
        "status": l.status,
        "created_at": _iso(l.created_at),
    }


def test_drive_dict(td: TestDrive) -> dict:
    return {
        "id": td.id,
        "call_id": td.call_id,
        "lead_id": td.lead_id,
        "model": td.model,
        "name": td.name,
        "phone": td.phone,
        "preferred_date": td.preferred_date,
        "preferred_time": td.preferred_time,
        "status": td.status,
        "created_at": _iso(td.created_at),
    }


def service_dict(s: ServiceAppointment) -> dict:
    return {
        "id": s.id,
        "call_id": s.call_id,
        "customer_name": s.customer_name,
        "phone": s.phone,
        "vehicle_model": s.vehicle_model,
        "registration_number": s.registration_number,
        "service_requirement": s.service_requirement,
        "preferred_time": s.preferred_time,
        "status": s.status,
        "created_at": _iso(s.created_at),
    }


def exchange_dict(e: ExchangeEnquiry) -> dict:
    return {
        "id": e.id,
        "call_id": e.call_id,
        "customer_name": e.customer_name,
        "phone": e.phone,
        "vehicle_make": e.vehicle_make,
        "vehicle_model": e.vehicle_model,
        "year": e.year,
        "variant": e.variant,
        "km": e.km,
        "condition": e.condition,
        "created_at": _iso(e.created_at),
    }


@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    return {
        "total_calls": db.query(Call).count(),
        "ai_handled_calls": db.query(Call).filter(Call.handed_off.is_(False)).count(),
        "leads": db.query(Lead).count(),
        "hot_leads": db.query(Lead).filter(Lead.score == "Hot").count(),
        "test_drives": db.query(TestDrive).count(),
        "service_appointments": db.query(ServiceAppointment).count(),
    }


@router.get("/calls")
def list_calls(db: Session = Depends(get_db)):
    calls = db.query(Call).order_by(Call.started_at.desc()).all()
    return [call_dict(c) for c in calls]


@router.get("/calls/{call_id}")
def get_call(call_id: int, db: Session = Depends(get_db)):
    call = db.get(Call, call_id)
    if call is None:
        raise HTTPException(status_code=404, detail="Call not found")
    payload = call_dict(call)
    payload["messages"] = [
        message_dict(m) for m in db.query(Message).filter(Message.call_id == call_id).all()
    ]
    payload["leads"] = [
        lead_dict(l) for l in db.query(Lead).filter(Lead.call_id == call_id).all()
    ]
    payload["test_drives"] = [
        test_drive_dict(t) for t in db.query(TestDrive).filter(TestDrive.call_id == call_id).all()
    ]
    payload["service_appointments"] = [
        service_dict(s)
        for s in db.query(ServiceAppointment).filter(ServiceAppointment.call_id == call_id).all()
    ]
    payload["exchange_enquiries"] = [
        exchange_dict(e)
        for e in db.query(ExchangeEnquiry).filter(ExchangeEnquiry.call_id == call_id).all()
    ]
    return payload


@router.get("/leads")
def list_leads(db: Session = Depends(get_db)):
    leads = db.query(Lead).order_by(Lead.created_at.desc()).all()
    return [lead_dict(l) for l in leads]


@router.get("/leads/{lead_id}")
def get_lead(lead_id: int, db: Session = Depends(get_db)):
    lead = db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead_dict(lead)


@router.get("/test-drives")
def list_test_drives(db: Session = Depends(get_db)):
    return [test_drive_dict(t) for t in db.query(TestDrive).order_by(TestDrive.created_at.desc()).all()]


@router.get("/service-appointments")
def list_service(db: Session = Depends(get_db)):
    return [service_dict(s) for s in db.query(ServiceAppointment).order_by(ServiceAppointment.created_at.desc()).all()]


@router.get("/exchanges")
def list_exchanges(db: Session = Depends(get_db)):
    return [exchange_dict(e) for e in db.query(ExchangeEnquiry).order_by(ExchangeEnquiry.created_at.desc()).all()]
