from visionary.settings import Settings


def test_settings_uses_defaults(monkeypatch):
    monkeypatch.delenv("VISIONARY_DB", raising=False)
    monkeypatch.delenv("VISIONARY_PORT", raising=False)
    monkeypatch.delenv("VISIONARY_HOST", raising=False)
    monkeypatch.delenv("VISIONARY_PUBLIC", raising=False)
    s = Settings()
    assert s.host == "127.0.0.1"
    assert s.port == 3344
    assert s.db_path.endswith("visionary.sqlite")
    assert s.public_dir.endswith("public")


def test_settings_reads_env_overrides(monkeypatch):
    monkeypatch.setenv("VISIONARY_DB", "/tmp/elsewhere.sqlite")
    monkeypatch.setenv("VISIONARY_PORT", "9999")
    monkeypatch.setenv("VISIONARY_HOST", "0.0.0.0")
    monkeypatch.setenv("VISIONARY_PUBLIC", "/tmp/pub")
    s = Settings()
    assert s.db_path == "/tmp/elsewhere.sqlite"
    assert s.port == 9999
    assert s.host == "0.0.0.0"
    assert s.public_dir == "/tmp/pub"
