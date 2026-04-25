import logging

from backend.core.generation_loop import _log_debug


def test_log_debug_emits_at_debug_level(caplog):
    with caplog.at_level(logging.DEBUG):
        _log_debug("loc", "msg", {"a": 1}, "H1")
    assert any("loc" in r.getMessage() for r in caplog.records)
