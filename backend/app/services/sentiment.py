"""On-call sentiment for the caller, scored from the words they just said.

This runs in-process on the finalized transcript. It does not call an LLM,
so publishing the score cannot add a network round trip to the speech path.
50 is neutral. Distress and anger pull the score down; thanks and praise
pull it up. The notification service treats anything under 40 as urgent.
"""

import re

_NEGATIVE: dict[str, int] = {
    "accident": 22,
    "angry": 18,
    "annoyed": 12,
    "breakdown": 16,
    "broke": 10,
    "complaint": 12,
    "crash": 22,
    "emergency": 20,
    "frustrated": 14,
    "furious": 22,
    "help": 6,
    "horrible": 16,
    "scared": 16,
    "stranded": 18,
    "stuck": 14,
    "terrible": 16,
    "tow": 8,
    "upset": 14,
    "useless": 14,
    "waiting": 6,
    "worst": 16,
}

_POSITIVE: dict[str, int] = {
    "excellent": 14,
    "good": 8,
    "great": 12,
    "happy": 12,
    "love": 8,
    "perfect": 12,
    "thank": 10,
    "thanks": 10,
    "wonderful": 12,
}

_TOKENS = re.compile(r"[a-z']+")


def score_utterance(text: str) -> int:
    """Return a 0–100 score for one caller turn. 50 when the text is neutral."""
    score = 50
    for token in _TOKENS.findall(text.lower()):
        score -= _NEGATIVE.get(token, 0)
        score += _POSITIVE.get(token, 0)
    return max(0, min(100, score))
