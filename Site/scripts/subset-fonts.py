"""Polices du site : sous-ensembles auto-hébergés (latin + français), produits depuis les paquets
@fontsource-variable installés et commités dans src/assets/fonts/ (le build n'a pas besoin de Python).

  python3 -m venv /tmp/fonts && /tmp/fonts/bin/pip install fonttools brotli
  /tmp/fonts/bin/python -I scripts/subset-fonts.py

- Bricolage Grotesque (titres) : graisse 800 et taille optique 96 figées, axe de chasse 75 → 100
  conservé (condensée dans le bandeau, normale dans les titres) ; 35 Ko au lieu de 78.
- Geist (texte) : graisses 400 → 700 ; 18 Ko au lieu de 29.
Licence : SIL Open Font License 1.1 (OFL-*.txt à côté des fichiers).
"""

import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(sys.argv[0])))
FS = os.path.join(ROOT, "node_modules", "@fontsource-variable")
OUT = os.path.join(ROOT, "src", "assets", "fonts")

# Latin de base, Latin-1, œ/Œ/Ÿ, apostrophe typographique, espaces fines, tirets, guillemets,
# points de suspension, euro, flèche, signe moins.
UNICODES = (
    "U+0020-007E,U+00A0-00FF,U+0152-0153,U+0178,U+02BC,U+02C6,U+02DA,U+02DC,U+2009,U+2011,"
    "U+2013-2014,U+2018-201A,U+201C-201E,U+2022,U+2026,U+202F,U+2039-203A,U+20AC,U+2192,U+2212"
)
FEATURES = ["kern", "liga", "calt", "ccmp", "locl", "mark", "mkmk", "tnum", "lnum", "case"]


def build(src: str, limits: dict, out: str) -> None:
    font = instancer.instantiateVariableFont(TTFont(src), limits)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = FEATURES
    opts.unicodes = subset.parse_unicodes(UNICODES)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=opts.unicodes)
    sub.subset(font)
    font.flavor = "woff2"
    font.save(os.path.join(OUT, out))
    print(f"{out} {os.path.getsize(os.path.join(OUT, out)) // 1024} Ko")


build(
    os.path.join(FS, "bricolage-grotesque", "files", "bricolage-grotesque-latin-standard-normal.woff2"),
    {"wght": 800, "opsz": 96, "wdth": (75, 100)},
    "bricolage-grotesque-800-wdth.woff2",
)
build(
    os.path.join(FS, "geist", "files", "geist-latin-wght-normal.woff2"),
    {"wght": (400, 700)},
    "geist-400-700.woff2",
)
