"""Données géographiques des scènes 6 et 7, commitées (le build n'a besoin ni de Python ni de réseau) :
  - src/data/region.json : sud du Bénin (Ouidah → Porto-Novo), grands axes, eaux, villes ; réseau
    fictif d'une compagnie (scène 6) ;
  - src/data/benin.json : contour du Bénin (Natural Earth 1:10m, celui de la migration
    Backend/db/migrations/*_seed_benin_boundary.sql) et côte ouest-africaine (Natural Earth
    1:110m), pour la vue de l'espace en 2D (scène 7, mode léger) ;
  - public/textures/earth.png : texture équirectangulaire du globe (rouge : terres en points ;
    vert : le Bénin), mode complet.

Sources : © les contributeurs d'OpenStreetMap (ODbL) ; Natural Earth (domaine public).

  /tmp/city/bin/pip install osmium shapely pillow
  curl -L -o /tmp/ne_110m_land.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson
  /tmp/city/bin/python -I scripts/gen-geo.py /tmp/benin.osm.pbf /tmp/ne_110m_land.geojson
"""

import glob
import json
import math
import os
import re
import sys

import osmium
from PIL import Image, ImageDraw
from shapely import ops
from shapely.geometry import LineString, MultiLineString, Point, box, shape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(sys.argv[0])))
PBF, LAND = sys.argv[1], sys.argv[2]


def path(geom, tol, fn, digits=1):
    g = geom.simplify(tol, preserve_topology=False) if tol else geom
    parts = []

    def ring(coords, close):
        pts = [fn(x, y) for x, y in coords]
        if len(pts) > 1:
            parts.append("M" + "L".join(f"{x:.{digits}f} {y:.{digits}f}" for x, y in pts) + ("Z" if close else ""))

    def walk(g):
        if g.is_empty:
            return
        if g.geom_type == "LineString":
            ring(g.coords, False)
        elif g.geom_type == "Polygon":
            ring(g.exterior.coords, True)
            for i in g.interiors:
                ring(i.coords, True)
        else:
            for sub in g.geoms:
                walk(sub)

    walk(g)
    return "".join(parts)


# ── Sud du Bénin ─────────────────────────────────────────────────────────────────────────────
WEST, EAST, SOUTH, NORTH = 1.98, 2.76, 6.30, 6.78
W = 1600.0
LAT0 = (SOUTH + NORTH) / 2
K = W / ((EAST - WEST) * math.cos(math.radians(LAT0)))
H = round((NORTH - SOUTH) * K, 1)
FRAME = box(WEST, SOUTH, EAST, NORTH)


def rxy(lon, lat):
    return ((lon - WEST) * math.cos(math.radians(LAT0)) * K, (NORTH - lat) * K)


class Collect(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.roads, self.coast, self.water, self.towns = [], [], [], []
        self.wkb = osmium.geom.WKBFactory()

    def way(self, w):
        hw = w.tags.get("highway")
        if hw in ("trunk", "primary", "motorway", "secondary") or w.tags.get("natural") == "coastline":
            try:
                line = LineString([(n.lon, n.lat) for n in w.nodes])
            except osmium.InvalidLocationError:
                return
            if line.intersects(FRAME):
                (self.coast if w.tags.get("natural") == "coastline" else self.roads).append(line)

    def area(self, a):
        if a.tags.get("natural") == "water" and a.tags.get("water") in ("lagoon", "lake", "river"):
            from shapely import wkb

            try:
                g = wkb.loads(self.wkb.create_multipolygon(a), hex=True)
            except Exception:
                return
            if g.intersects(FRAME) and g.area > 4e-6:
                self.water.append(g.intersection(FRAME))

    def node(self, n):
        if n.tags.get("place") in ("city", "town") and FRAME.contains(Point(n.location.lon, n.location.lat)):
            self.towns.append({"name": n.tags.get("name"), "kind": n.tags.get("place"), "at": rxy(n.location.lon, n.location.lat)})


c = Collect()
c.apply_file(PBF, locations=True)
view = box(0, 0, W, H)
proj = lambda g: ops.transform(lambda x, y, z=None: rxy(x, y), g)  # noqa: E731
ident = lambda x, y: (x, y)  # noqa: E731
roads = ops.linemerge(MultiLineString([proj(l) for l in c.roads])).intersection(view)
coast = ops.linemerge(MultiLineString([proj(l) for l in c.coast])).intersection(view)
lines = [g for g in getattr(coast, "geoms", [coast]) if g.geom_type == "LineString"]
faces = ops.polygonize(ops.unary_union([*lines, view.exterior]))
probes = [Point(*rxy(2.1, 6.31)), Point(*rxy(2.6, 6.33))]
ocean = ops.unary_union([f for f in faces if any(f.contains(p) for p in probes)])
water = ops.unary_union([proj(w) for w in c.water] + [ocean]).intersection(view)
region = {
    "width": W,
    "height": H,
    "bbox": [WEST, SOUTH, EAST, NORTH],
    "metersPerUnit": 111_320 * (EAST - WEST) * math.cos(math.radians(LAT0)) / W,
    "roads": path(roads, 1.2, ident),
    "water": path(water, 1.2, ident),
    "towns": [t for t in c.towns if t["name"]],
}

# Réseau fictif d'une compagnie (scène 6) : stations posées près des villes, sans nom ni marque.
spec = [
    ("Cotonou", 2.418, 6.372, "stock"), ("Cotonou", 2.385, 6.360, "stock"), ("Cotonou", 2.452, 6.381, "low"),
    ("Abomey-Calavi", 2.350, 6.448, "stock"), ("Abomey-Calavi", 2.322, 6.420, "rupture"),
    ("Porto-Novo", 2.616, 6.497, "stock"), ("Sèmè-Kpodji", 2.560, 6.380, "low"), ("Ouidah", 2.085, 6.366, "stock"),
    ("Pahou", 2.168, 6.383, "stock"),
]
region["network"] = [{"town": t, "status": s, "at": rxy(lon, lat)} for t, lon, lat, s in spec]

# ── Bénin et Afrique de l'Ouest ──────────────────────────────────────────────────────────────
sql = open(glob.glob(os.path.join(ROOT, "..", "Backend", "db", "migrations", "*_seed_benin_boundary.sql"))[0]).read()
benin = shape(json.loads(re.search(r"ST_GeomFromGeoJSON\('(.+?)'\)", sql, re.S).group(1)))
land = ops.unary_union([shape(f["geometry"]) for f in json.load(open(LAND))["features"]])

# Vue de l'espace (2D) : projection orthographique centrée sur le Bénin, vue de haut.
LON0, LAT0O = 2.3, 9.3
R = 1000.0


def ortho(lon, lat):
    l, p = math.radians(lon - LON0), math.radians(lat)
    p0 = math.radians(LAT0O)
    x = R * math.cos(p) * math.sin(l)
    y = R * (math.cos(p0) * math.sin(p) - math.sin(p0) * math.cos(p) * math.cos(l))
    return (x, -y)


def visible(lon, lat):
    l, p, p0 = math.radians(lon - LON0), math.radians(lat), math.radians(LAT0O)
    return math.sin(p0) * math.sin(p) + math.cos(p0) * math.cos(p) * math.cos(l) > 0.02


# Terres en points sur l'hémisphère visible (même rendu que le globe 3D), un seul chemin SVG.
from shapely.prepared import prep as _prep  # noqa: E402

_pl = _prep(land)
dots = []
lat = -88.0
while lat < 88:
    n = max(1, int(360 * math.cos(math.radians(lat)) / 1.4))
    for i in range(n):
        lon = -180 + (i + 0.5) * 360 / n
        if visible(lon, lat) and _pl.contains(Point(lon, lat)):
            x, y = ortho(lon, lat)
            dots.append(f"M{x - 5:.0f} {y:.0f}a5 5 0 1 0 10 0a5 5 0 1 0-10 0")
    lat += 1.4
benin_json = {
    "radius": R,
    "center": [LON0, LAT0O],
    "benin": path(benin, 0.01, ortho, 1),
    "land": "".join(dots),
    "beninCenter": ortho(benin.centroid.x, benin.centroid.y),
    "cotonou": ortho(2.418, 6.37),
    # Contour en lon/lat (simplifié) pour le globe 3D.
    "outline": [
        [round(x, 3), round(y, 3)]
        for x, y in max(getattr(benin.simplify(0.02), "geoms", [benin.simplify(0.02)]), key=lambda g: g.area).exterior.coords
    ],
}

# ── Texture du globe : terres en points (rouge), Bénin plein (vert) ─────────────────────────
TW, TH = 2048, 1024
img = Image.new("RGB", (TW, TH))
draw = ImageDraw.Draw(img)
step = 0.9  # degrés de latitude entre deux rangées de points
from shapely.prepared import prep  # noqa: E402

pland = prep(land)
lat = -90 + step / 2
while lat < 90:
    n = max(1, int(360 * math.cos(math.radians(lat)) / step))
    for i in range(n):
        lon = -180 + (i + 0.5) * 360 / n
        if pland.contains(Point(lon, lat)):
            x, y = (lon + 180) / 360 * TW, (90 - lat) / 180 * TH
            r = 1.6
            draw.ellipse((x - r, y - r, x + r, y + r), fill=(255, 0, 0))
    lat += step


def tex(lon, lat):
    return ((lon + 180) / 360 * TW, (90 - lat) / 180 * TH)


green = Image.new("L", (TW, TH))
for poly in getattr(benin, "geoms", [benin]):
    ImageDraw.Draw(green).polygon([tex(x, y) for x, y in poly.exterior.coords], fill=255)
r, _, b = img.split()
img = Image.merge("RGB", (r, green, b))
os.makedirs(os.path.join(ROOT, "public", "textures"), exist_ok=True)
img.save(os.path.join(ROOT, "public", "textures", "earth.png"), optimize=True)

os.makedirs(os.path.join(ROOT, "src", "data"), exist_ok=True)
for name, data in (("region", region), ("benin", benin_json)):
    with open(os.path.join(ROOT, "src", "data", f"{name}.json"), "w") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
for f in ("src/data/region.json", "src/data/benin.json", "public/textures/earth.png"):
    print(f"{f} {os.path.getsize(os.path.join(ROOT, f)) // 1024} Ko")
print(f"villes {len(region['towns'])} : {', '.join(t['name'] for t in region['towns'])}")
