"""Write docs/openapi.json from the implemented app.

    python -m app.export_openapi
"""
from __future__ import annotations

import json
from pathlib import Path

from .config import ROOT, Settings
from .main import create_app


def build_spec() -> dict:
    return create_app(Settings(cors_origins=["*"])).openapi()


def main() -> None:
    out = ROOT / "docs" / "openapi.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(build_spec(), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
