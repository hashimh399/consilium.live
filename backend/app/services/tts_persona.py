"""Turn-wise prosody for the voice loop.

The dialogue manager settles an intent for every turn. This module maps that
intent to a speaking step and a Cartesia persona. Cartesia Sonic accepts only
three style controls in `generation_config`: speed, volume, and emotion.
Emotion carries the delivery style, and volume adds weight to it.
The persona label is the `voice_profile_used` value on the live-call HUD.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class TtsPersona:
    """One speaking style. `label` is the value published as voice_profile_used."""

    label: str
    speed: float
    volume: float
    emotion: str


BASELINE = TtsPersona(
    label="Baseline (Hinglish)",
    speed=1.0,
    volume=1.0,
    emotion="content",
)
# Calm and sympathetic. Slower and a little softer.
EMPATHY = TtsPersona(
    label="Empathy (Hinglish)",
    speed=0.9,
    volume=0.9,
    emotion="sympathetic",
)
# Upbeat, energetic, sales. Slightly faster and brighter.
UPBEAT = TtsPersona(
    label="Upbeat (Hinglish)",
    speed=1.05,
    volume=1.15,
    emotion="enthusiastic",
)

_BY_LABEL = {profile.label: profile for profile in (BASELINE, EMPATHY, UPBEAT)}

# Dialogue intent -> speaking step. Anything not listed is standard delivery.
STEP_BY_INTENT: dict[str, str] = {
    "rsa": "Handling RSA",
    "inventory": "Checking Inventory",
    "sales": "Sales Enquiry",
    "service": "Service Booking",
}

# Speaking step -> synthesis parameters. This is the prosody switch.
PROSODY_BY_STEP: dict[str, TtsPersona] = {
    "Handling RSA": EMPATHY,
    "Checking Inventory": UPBEAT,
    "Sales Enquiry": UPBEAT,
    "Service Booking": BASELINE,
    "Assisting": BASELINE,
    "Verifying": BASELINE,
    "Greeting": BASELINE,
}


def persona_for_label(persona_profile: str) -> TtsPersona:
    """Resolve a published voice name to its Cartesia prosody. Unknown names use baseline."""
    return _BY_LABEL.get(persona_profile, BASELINE)


def select_speaking_state(
    intent: str | None,
    *,
    identified: bool = False,
    opening: bool = False,
) -> tuple[str, TtsPersona]:
    """Return (current_step, persona) for the line about to be synthesized.

    Roadside, inventory, and sales win over identity, so an urgent or sales
    turn uses that voice even when the caller has not given their name.
    Service and identity checks use the standard 1.0x delivery. The canned
    first line is Greeting. After that a turn with no settled intent is
    Assisting for a known caller and Verifying for an unknown one.
    """
    step = STEP_BY_INTENT.get(intent or "")
    if step is None:
        if opening:
            step = "Greeting"
        else:
            step = "Assisting" if identified else "Verifying"
    return step, PROSODY_BY_STEP[step]
