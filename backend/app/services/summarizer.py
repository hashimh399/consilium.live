import httpx

from app.services.llm import chat_json


async def summarize_call(transcript: str, http_client: httpx.AsyncClient | None = None) -> dict:
    """Return {intent, summary, next_action} from the full call transcript."""
    prompt = (
        "You are a sales operations assistant. Given the transcript of a phone call "
        "between a Consilium dealership AI agent and a customer, produce a JSON object with exactly "
        "these keys: intent (short label like 'Sales', 'Test Drive', 'Service', 'Exchange', or 'Other'), "
        "summary (2-3 sentences of what happened), and next_action (the recommended follow-up for the sales team).\n\n"
        f"Transcript:\n{transcript}"
    )
    return await chat_json(
        [
            {
                "role": "system",
                "content": "Always respond with a valid JSON object and nothing else.",
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
        http_client=http_client,
    )
