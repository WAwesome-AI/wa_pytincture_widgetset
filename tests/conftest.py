"""
Shared pytest configuration for the wapyt unit tests.

The unit tests exercise the pure-Python half of the widgetset (config
serialization, stream handling) and deliberately avoid importing Pyodide, so
they run under plain CPython. Adding the repository root to ``sys.path`` lets
them run straight from a clone without `pip install -e .` first.
"""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
