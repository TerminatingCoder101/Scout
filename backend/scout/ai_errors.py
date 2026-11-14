"""Actionable provider errors without exposing credentials or request contents."""


def describe_ai_error(exc):
    message = str(exc).lower()
    if "400" in message or "invalid_argument" in message:
        return "Google rejected the AI request format (400). This is an integration or model compatibility issue; your API key may be valid."
    if "503" in message or "unavailable" in message or "high demand" in message:
        return "Google's Gemini model is temporarily overloaded (503). Your key may be valid. Retry shortly or choose another Gemini model in Settings."
    if "429" in message or "resource_exhausted" in message:
        return "Google's Gemini quota or rate limit was reached (429). Check your project's quota and billing, or retry after the rate limit resets."
    if "401" in message or "api_key_invalid" in message:
        return "Google rejected the Gemini API key. Replace the saved key in Settings."
    if "403" in message or "permission_denied" in message:
        return "Google denied this Gemini request (403). Check the key's API restrictions and project permissions."
    if "404" in message or "not_found" in message:
        return "The configured Gemini model is unavailable (404). Choose a model your key can access in Settings."
    if (
        isinstance(exc, TimeoutError)
        or "timeout" in message
        or "timed out" in message
        or "504" in message
        or "deadline_exceeded" in message
    ):
        return "The Gemini inspection timed out. Retry or choose a faster model in Settings."
    if "connect" in message or "name resolution" in message or "nodename" in message:
        return "Scout could not connect to Google. Check this laptop's internet connection and retry."
    return "AI inspection did not complete. Check the selected model and Google service availability, then retry."
