import argparse
from datetime import datetime, timedelta, timezone

from app.db import Base, SessionLocal, engine
from app.models import Call, Lead, Message, TestDrive


def seed_demo() -> None:
    db = SessionLocal()
    try:
        if db.query(Call).count() > 0:
            print("Database already has data; skipping demo seed.")
            return

        now = datetime.now(timezone.utc)
        call = Call(
            call_sid="DEMO0001",
            from_number="+91 98765 43210",
            to_number="+91 00000 00000",
            status="completed",
            intent="Test Drive",
            lead_score="Hot",
            summary=(
                "Customer is looking for a new SUV for a family of four with a budget around "
                "15 lakhs. The AI recommended the Seltos and booked a test drive for Saturday."
            ),
            next_action="Confirm the test drive slot and follow up over the weekend.",
            handed_off=False,
            started_at=now - timedelta(minutes=6),
            ended_at=now - timedelta(minutes=3),
        )
        db.add(call)
        db.flush()

        db.add_all(
            [
                Message(call_id=call.id, role="customer", content="Hi, I'm looking for a new SUV for my family."),
                Message(call_id=call.id, role="assistant", content="Of course. How many people will usually travel with you?"),
                Message(call_id=call.id, role="customer", content="Four of us, and my budget is around fifteen lakhs."),
                Message(call_id=call.id, role="assistant", content="The Seltos would be a great fit. It seats five and has strong safety features."),
                Message(call_id=call.id, role="customer", content="Great, can I book a test drive on Saturday morning?"),
                Message(call_id=call.id, role="assistant", content="Sure. I've booked your Seltos test drive for Saturday."),
            ]
        )

        lead = Lead(
            call_id=call.id,
            name="Rahul Sharma",
            phone="+91 98765 43210",
            budget="15 lakhs",
            preferred_model="Seltos",
            passengers="4",
            timeline="This month",
            recommended_model="Seltos",
            score="Hot",
            score_reasons="Near-term purchase timeline; Phone number captured; Budget known; Model preference known",
        )
        db.add(lead)
        db.flush()

        db.add(
            TestDrive(
                call_id=call.id,
                lead_id=lead.id,
                model="Seltos",
                name="Rahul Sharma",
                phone="+91 98765 43210",
                preferred_date="Saturday",
                preferred_time="11:00 AM",
            )
        )
        db.commit()
        print("Demo data seeded.")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create tables and optionally seed demo data.")
    parser.add_argument("--demo", action="store_true", help="Seed a demo call + lead + test drive")
    args = parser.parse_args()

    Base.metadata.create_all(bind=engine)
    if args.demo:
        seed_demo()
    else:
        print("Tables created.")
