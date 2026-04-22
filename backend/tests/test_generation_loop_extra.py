import pytest
from unittest.mock import patch, mock_open
from backend.core.generation_loop import _log_debug

def test_log_debug_exception():
    with patch("builtins.open", side_effect=Exception("Mocked open exception")):
        # This should swallow the exception and not raise
        _log_debug("loc", "msg", {}, "H1")

def test_log_debug_success():
    m = mock_open()
    with patch("builtins.open", m):
        _log_debug("loc", "msg", {}, "H1")
        m.assert_called_once()
        m().write.assert_called()
