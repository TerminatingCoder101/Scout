import importlib
from urllib.parse import quote_plus

import pytest

config = importlib.import_module("scout.config")


@pytest.fixture
def clean_env(monkeypatch, tmp_path):
    for key in ("MONGODB_URI", "MONGODB_DB", "MONGODB_USERNAME", "MONGODB_PASSWORD"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(config, "ROOT", tmp_path)
    return tmp_path


def test_env_reads_credentials_and_escapes_special_characters(clean_env):
    (clean_env / ".env").write_text(
        "MONGODB_URI=mongodb+srv://cluster.example.test/?retryWrites=true&w=majority\nMONGODB_USERNAME='user@name'\nMONGODB_PASSWORD='p@ss/$word:#'\nMONGODB_DB=history\n"
    )
    uri, db = config.mongodb_settings()
    assert (
        uri
        == f"mongodb+srv://{quote_plus('user@name')}:{quote_plus('p@ss/$word:#')}@cluster.example.test/?retryWrites=true&w=majority"
    )
    assert db == "history"


def test_atlas_placeholder_and_process_environment_precedence(clean_env, monkeypatch):
    (clean_env / ".env").write_text(
        "MONGODB_URI=mongodb+srv://<db_username>:<db_password>@cluster.example.test/\nMONGODB_USERNAME=fileuser\nMONGODB_PASSWORD=filepass\nMONGODB_DB=local\n"
    )
    uri, db = config.mongodb_settings()
    assert uri == "mongodb+srv://fileuser:filepass@cluster.example.test/"
    monkeypatch.setenv("MONGODB_URI", "mongodb://envuser:envpass@localhost:27017/")
    monkeypatch.setenv("MONGODB_DB", "override")
    assert config.mongodb_settings() == (
        "mongodb://envuser:envpass@localhost:27017/",
        "override",
    )
    monkeypatch.setenv("MONGODB_URI", "")
    assert config.mongodb_settings() == ("", "override")


def test_no_file_and_invalid_credential_combinations(clean_env, monkeypatch):
    assert config.mongodb_settings() == ("", "scout")
    (clean_env / ".env").write_text(
        "MONGODB_URI=mongodb://localhost/\nMONGODB_USERNAME=user\n"
    )
    with pytest.raises(ValueError, match="both"):
        config.mongodb_settings()
    (clean_env / ".env").write_text(
        "MONGODB_URI=mongodb://old:secret@localhost/\nMONGODB_USERNAME=user\nMONGODB_PASSWORD=pass\n"
    )
    with pytest.raises(ValueError, match="embedded"):
        config.mongodb_settings()
