"""
Generate the safe demo sample set (G13): abstract, non-personal images with no EXIF/metadata.

  python apps/web/scripts/generate-samples.py

Writes inputs (PNG, 1920x1280) and expected outputs (WebP, max width 1600, quality 82 — the
image-transform defaults) to apps/web/public/samples/, plus manifest.json with sizes + sha256 digests.
Requires Pillow.
"""
import hashlib
import json
import math
import os
from pathlib import Path

from PIL import Image, ImageDraw

APP = Path(__file__).resolve().parent.parent
OUT = APP / "public" / "samples"
ART = APP / "mock-artifacts"
MANIFEST = APP / "src" / "mock" / "sample-manifest.json"
W, H = 1920, 1280
PAPER = (245, 243, 238)
INK = (17, 17, 17)
LIME = (200, 255, 60)


def contour_field() -> Image.Image:
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    for i in range(46):
        y0 = 80 + i * 26
        pts = [(x, y0 + 60 * math.sin(x / 210 + i * 0.35) + 30 * math.sin(x / 90)) for x in range(0, W + 20, 20)]
        d.line(pts, fill=LIME if i % 9 == 4 else INK, width=6 if i % 9 == 4 else 2)
    return img


def node_grid() -> Image.Image:
    img = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(img)
    step = 120
    nodes = [(x, y) for x in range(120, W, step) for y in range(120, H, step)]
    for i, (x, y) in enumerate(nodes):
        if (x // step + y // step) % 3 == 0:
            d.line([(x, y), (x + step, y)], fill=(70, 70, 66), width=2)
        if (x // step * 7 + y // step) % 4 == 0:
            d.line([(x, y), (x, y + step)], fill=(70, 70, 66), width=2)
    for i, (x, y) in enumerate(nodes):
        lit = (i * 37) % 11 == 0
        r = 14 if lit else 7
        d.ellipse([x - r, y - r, x + r, y + r], fill=LIME if lit else PAPER)
    return img


def orbit_rings() -> Image.Image:
    img = Image.new("RGB", (W, H), (236, 232, 222))
    d = ImageDraw.Draw(img)
    cx, cy = W // 2, H // 2
    for i in range(18):
        r = 40 + i * 34
        d.ellipse([cx - r * 1.5, cy - r, cx + r * 1.5, cy + r], outline=INK, width=2)
    for k in range(9):
        a = k * 0.7
        r = 40 + (k * 2 + 3) * 34
        x, y = cx + r * 1.5 * math.cos(a), cy + r * math.sin(a)
        d.ellipse([x - 22, y - 22, x + 22, y + 22], fill=LIME, outline=INK, width=3)
    return img


def photographic(img: Image.Image, seed: int) -> Image.Image:
    """Adds a soft light falloff and sensor-like grain so the sample behaves like a photo."""
    grain = Image.effect_noise((W, H), 28).convert("RGB")
    light = Image.radial_gradient("L").resize((W, H)).convert("RGB")
    img = Image.blend(img, light, 0.12 + seed * 0.03)
    return Image.blend(img, grain, 0.10)


def sha256(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ART.mkdir(parents=True, exist_ok=True)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    samples = {"contour-field": contour_field, "node-grid": node_grid, "orbit-rings": orbit_rings}
    manifest = {"inputs": [], "outputs": []}
    for seed, (name, fn) in enumerate(samples.items()):
        img = photographic(fn(), seed)
        src = OUT / f"{name}.png"
        img.save(src, "PNG", optimize=True)
        out = ART / f"{name}.webp"
        ratio = 1600 / img.width
        img.resize((1600, round(img.height * ratio)), Image.LANCZOS).save(out, "WEBP", quality=82, method=6)
        manifest["inputs"].append({"name": src.name, "contentType": "image/png", "bytes": src.stat().st_size, "digest": sha256(src)})
        manifest["outputs"].append(
            {"name": out.name, "file": out.name, "contentType": "image/webp", "bytes": out.stat().st_size, "digest": sha256(out), "width": 1600, "height": round(img.height * ratio)}
        )
    MANIFEST.write_text(json.dumps(manifest, indent=2) + os.linesep)
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
