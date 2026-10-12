def score_lead(fields: dict) -> tuple[str, list[str]]:
    """Rule-based lead scoring. Returns (Hot|Warm|Cold, reasons)."""
    points = 0
    reasons: list[str] = []

    timeline = (fields.get("timeline") or "").lower()
    near_term = any(
        w in timeline
        for w in ("immediate", "this week", "this month", "asap", "soon", "urgent", "today")
    )
    if near_term:
        points += 3
        reasons.append("Near-term purchase timeline")
    elif timeline:
        points += 1
        reasons.append("Timeline provided")

    if fields.get("phone"):
        points += 2
        reasons.append("Phone number captured")

    if fields.get("budget"):
        points += 1
        reasons.append("Budget known")

    if fields.get("preferred_model"):
        points += 1
        reasons.append("Model preference known")

    if points >= 5:
        label = "Hot"
    elif points >= 3:
        label = "Warm"
    else:
        label = "Cold"

    if not reasons:
        reasons.append("Limited qualifying information")

    return label, reasons
