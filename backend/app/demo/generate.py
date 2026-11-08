# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Generate the demo documents (development).

    uv run python -m app.demo.generate            # write demo_data/northbridge/courses
                                                  # and demo_data/construction/documents
    uv run python -m app.demo.generate --check    # verify the committed files, byte for byte

Writes exactly the files in ``northbridge_content.DOCUMENTS`` and
``supplement_content.SUPPLEMENT_DOCUMENTS`` (the inherited evaluation corpus),
and ``construction_content.CONSTRUCTION_DOCUMENTS`` (the demo). ``--check``
fails if any committed file differs from a fresh render, or if an unlisted
file sits under ``courses/`` or ``documents/``.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from app.demo.construction_content import AUTHOR as CONSTRUCTION_AUTHOR
from app.demo.construction_content import CONSTRUCTION_DOCUMENTS
from app.demo.northbridge_content import DOCUMENTS
from app.demo.render import render, render_pdf
from app.demo.supplement_content import SUPPLEMENT_DOCUMENTS

DATA_ROOT = Path(__file__).resolve().parents[3] / "demo_data" / "northbridge"
CONSTRUCTION_ROOT = DATA_ROOT.parent / "construction"


def build_all() -> dict[str, bytes]:
    return {path: render(doc) for path, doc in sorted((DOCUMENTS | SUPPLEMENT_DOCUMENTS).items())}


def build_construction() -> dict[str, bytes]:
    return {
        path: render_pdf(doc, author=CONSTRUCTION_AUTHOR)
        for path, doc in sorted(CONSTRUCTION_DOCUMENTS.items())
    }


def differences(root: Path, built: dict[str, bytes], folder: str = "courses") -> list[str]:
    problems = []
    for path, data in built.items():
        file = root / path
        if not file.is_file():
            problems.append(f"{path}: missing")
        elif file.read_bytes() != data:
            problems.append(f"{path}: differs from a fresh render")
    generated = root / folder
    present = (
        {p.relative_to(root).as_posix() for p in generated.rglob("*") if p.is_file()}
        if generated.is_dir()
        else set()
    )
    problems.extend(f"{extra}: not generated" for extra in sorted(present - built.keys()))
    return problems


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.demo.generate")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--root", type=Path, default=DATA_ROOT)
    parser.add_argument("--construction-root", type=Path, default=CONSTRUCTION_ROOT)
    args = parser.parse_args(argv)
    sets = (
        (args.root, build_all(), "courses"),
        (args.construction_root, build_construction(), "documents"),
    )
    if args.check:
        problems = [p for root, built, folder in sets for p in differences(root, built, folder)]
        for problem in problems:
            print(problem)
        return 1 if problems else 0
    for root, built, _ in sets:
        for path, data in built.items():
            target = root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        print(f"wrote {len(built)} files under {root}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
