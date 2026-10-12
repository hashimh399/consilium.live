"""Demo DMS snapshot served by the voice agent on port 8000.

Facts for the workshops come from PAL Jay's published J&K network.
Part counts are a fixed demo shelf, not a live warehouse feed.
"""

from fastapi import APIRouter

from app.knowledge.loader import load_knowledge

router = APIRouter(prefix="/v1/mock/dms", tags=["dms"])

# VIN last 4 only. A full 17-character VIN is not published for these callers.
CUSTOMERS = {
    "6005802921": {
        "name": "Arjun Sharma",
        "vip_status": "Gold",
        "vehicle_owned": "Seltos HTX",
        "vehicle": "Seltos HTX",
        "vin_last_4": "4491",
        "ownership_type": "EXISTING OWNER",
        "last_service_date": "2024-08-10",
        "last_service_package": "10,000 km periodic maintenance",
        "next_service": "20,000 km periodic maintenance",
        "preferred_dealer": "PAL Jay Jammu",
        "source": "DMS (PAL Jay Jammu)",
    },
    "9906358704": {
        "name": "Sarah Khan",
        "vip_status": "Silver",
        "vehicle_owned": "N/A",
        "vin_last_4": "N/A",
        "ownership_type": "HOT LEAD",
        "last_service_date": "N/A",
        "preferred_dealer": "PAL Jay Srinagar",
        "interest_notes": (
            "DMS lead lookup: deep interest in the EV6 GT and the EV9 GT-Line. "
            "No vehicle or VIN is on file."
        ),
        "source": "CRM (Lead Capture)",
    },
}


def dms_snapshot() -> dict:
    kb = load_knowledge()
    return {
        "source": "DMS (PAL Jay demo)",
        "region": "Jammu and Kashmir, with the nearest Delhi-NCR outlet",
        "dealerships": kb["dealership"]["branches"],
        "vehicles": [
            model
            for model in kb.get("models", [])
            if model["name"] in {"Seltos HTX", "EV6 GT", "EV9 GT-Line"}
        ],
        "service_intervals": kb.get("service_intervals", []),
        "parts": kb.get("parts", []),
        "customers": CUSTOMERS,
    }


@router.get("")
async def get_dms():
    """Dealerships, the three demo vehicles, service packages, and parts."""
    return dms_snapshot()
