import pytest
from scout.ai_errors import describe_ai_error


@pytest.mark.parametrize(
    "detail,expected",
    [
        ("503 UNAVAILABLE high demand", "overloaded"),
        ("429 RESOURCE_EXHAUSTED", "quota"),
        ("401 API_KEY_INVALID", "rejected"),
        ("403 PERMISSION_DENIED", "denied"),
        ("404 NOT_FOUND", "model"),
        ("Connection refused", "connect"),
        ("504 DEADLINE_EXCEEDED", "timed out"),
    ],
)
def test_provider_errors_are_actionable_and_redacted(detail, expected):
    result = describe_ai_error(RuntimeError(detail + " secret-api-key"))
    assert expected in result
    assert "secret-api-key" not in result


def test_unknown_error_does_not_expose_request():
    assert "secret" not in describe_ai_error(RuntimeError("secret request"))
