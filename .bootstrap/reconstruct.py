from pathlib import Path, PurePosixPath
import base64, hashlib, shutil, zipfile
from io import BytesIO
ROOT = Path(__file__).resolve().parents[1]
BOOT = ROOT / ".bootstrap"
EXPECTED = {
    "source": "07d5bf0bdcb993b35d90029642449e4a516f3eb70374cc83bcffaeff2858a509",
    "docs": "2e8ca99e014846ca9ce45b9480448bd58a20245c75bafac46f71d3063a4907d5",
}
def load_archive(kind):
    files = sorted((BOOT / "payload" / kind).glob("*.part"))
    if not files:
        raise SystemExit(f"Missing {kind} transfer chunks")
    encoded = "".join(p.read_text(encoding="ascii") for p in files)
    data = base64.b64decode(encoded, validate=True)
    actual = hashlib.sha256(data).hexdigest()
    if actual != EXPECTED[kind]:
        raise SystemExit(f"{kind} ZIP SHA-256 mismatch: {actual}")
    with zipfile.ZipFile(BytesIO(data)) as z:
        bad = z.testzip()
        if bad:
            raise SystemExit(f"{kind} ZIP CRC error: {bad}")
    return data
def extract_archive(data, kind):
    count = 0
    with zipfile.ZipFile(BytesIO(data)) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            item = PurePosixPath(info.filename)
            if item.is_absolute() or ".." in item.parts:
                raise SystemExit(f"Unsafe archive path: {info.filename}")
            if kind == "source":
                prefix = "N1PilotDesktop-1.0.3/"
                if not info.filename.startswith(prefix):
                    raise SystemExit(f"Unexpected source entry: {info.filename}")
                relative = PurePosixPath(*item.parts[1:])
                target = ROOT / "docs" / "source-snapshot-v1.0.3" / "README.md" if relative.as_posix() == "README.md" else ROOT.joinpath(*relative.parts)
            else:
                target = ROOT.joinpath(*item.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(z.read(info.filename))
            count += 1
    return count
source = load_archive("source")
docs = load_archive("docs")
sc = extract_archive(source, "source")
dc = extract_archive(docs, "docs")
if sc != 42:
    raise SystemExit(f"Expected 42 source files; got {sc}")
print(f"ZIP hashes and CRC passed. Reconstructed {sc} source and {dc} documentation files.")
shutil.rmtree(BOOT)
