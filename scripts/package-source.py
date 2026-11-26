#!/usr/bin/env python3
"""Build the canonical versioned source archive and verify every listed file."""
from pathlib import Path
import hashlib, sys, zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
MANIFEST = ROOT / "checksums" / f"N1PilotDesktop-{VERSION}-SOURCE-MANIFEST.sha256"
OUT_DIR = ROOT / "dist" / "release-assets"
OUT_DIR.mkdir(parents=True, exist_ok=True)
ARCHIVE_NAME = f"N1PilotDesktop-{VERSION}.zip"
ARCHIVE = OUT_DIR / ARCHIVE_NAME
PREFIX = f"N1PilotDesktop-{VERSION}/"

entries = []
for line in MANIFEST.read_text(encoding="utf-8").splitlines():
    if not line.strip():
        continue
    try:
        digest, path = line.split(None, 1)
    except ValueError:
        raise SystemExit(f"Invalid manifest line: {line!r}")
    path = path.strip()
    if not path.startswith(PREFIX):
        raise SystemExit(f"Unexpected manifest path: {path}")
    rel = path[len(PREFIX):]
    source = ROOT / rel
    if rel == "README.md":
        source = ROOT / "docs" / "source-snapshot-v1.0.3" / "README.md"
    if not source.is_file():
        raise SystemExit(f"Missing source file: {rel} ({source})")
    actual = hashlib.sha256(source.read_bytes()).hexdigest()
    if actual != digest:
        raise SystemExit(f"SHA-256 mismatch for {rel}: expected {digest}, got {actual}")
    entries.append((rel, source))

if len(entries) != 42:
    raise SystemExit(f"Expected 42 versioned source files, found {len(entries)}")
with zipfile.ZipFile(ARCHIVE, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for rel, source in sorted(entries):
        zf.write(source, arcname=PREFIX + rel)

digest = hashlib.sha256(ARCHIVE.read_bytes()).hexdigest()
(OUT_DIR / f"{ARCHIVE_NAME}.sha256").write_text(f"{digest}  {ARCHIVE_NAME}\n", encoding="utf-8")
print(f"Created {ARCHIVE} ({ARCHIVE.stat().st_size} bytes; {len(entries)} files)")
print(f"SHA-256 {digest}")
