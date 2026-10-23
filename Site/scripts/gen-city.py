"""Carte de Cotonou du site (scènes 2 à 4) : géométrie seule, projetée et simplifiée, sans couleur
(les SVG sont rendus au build avec les tokens : src/pages/maps/). Sortie : src/data/city.json,
commitée (le build n'a besoin ni de Python ni d'OpenStreetMap).

Données : © les contributeurs d'OpenStreetMap (ODbL), extrait Geofabrik du Bénin ; trajets calculés
par notre OSRM (make up) sur les vraies routes. Les stations sont des points fictifs posés sur les
routes : aucune vraie station, aucune marque.

  python3 -m venv /tmp/city && /tmp/city/bin/pip install osmium shapely
  curl -L -o /tmp/benin.osm.pbf https://download.geofabrik.de/africa/benin-latest.osm.pbf
  /tmp/city/bin/python -I scripts/gen-city.py /tmp/benin.osm.pbf [http://127.0.0.1:5000]
"""

import json
import math
import os
import sys
import urllib.request

import osmium
from shapely import ops
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box, mapping, shape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(sys.argv[0])))
PBF = sys.argv[1]
OSRM = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:5000"

# Cadre : centre de Cotonou, les deux rives du chenal, le littoral. 11 × 6,6 km.
WEST, EAST, SOUTH, NORTH = 2.370, 2.470, 6.345, 6.405
W = 1600.0
LAT0 = (SOUTH + NORTH) / 2
K = W / ((EAST - WEST) * math.cos(math.radians(LAT0)))
H = round((NORTH - SOUTH) * K, 1)
METERS_PER_UNIT = 111_320 * (EAST - WEST) * math.cos(math.radians(LAT0)) / W


def xy(lon, lat):
    return ((lon - WEST) * math.cos(math.radians(LAT0)) * K, (NORTH - lat) * K)


def lonlat(x, y):
    return (WEST + x / (math.cos(math.radians(LAT0)) * K), NORTH - y / K)


FRAME = box(WEST - 0.002, SOUTH - 0.002, EAST + 0.002, NORTH + 0.002)
ROAD_CLASS = {
    "motorway": "major", "trunk": "major", "primary": "major", "secondary": "major",
    "motorway_link": "major", "trunk_link": "major", "primary_link": "major", "secondary_link": "major",
    "tertiary": "medium", "tertiary_link": "medium",
    "residential": "minor", "unclassified": "minor", "living_street": "minor",
}


class Collect(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.roads = {"major": [], "medium": [], "minor": []}
        self.coast = []
        self.water = []
        self.places = []

    def way(self, w):
        tags = w.tags
        hw = tags.get("highway")
        try:
            coords = [(n.lon, n.lat) for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        if len(coords) < 2:
            return
        line = LineString(coords)
        if not line.intersects(FRAME):
            return
        if hw in ROAD_CLASS:
            self.roads[ROAD_CLASS[hw]].append(line)
        if tags.get("natural") == "coastline":
            self.coast.append(line)

    def area(self, a):
        tags = a.tags
        if tags.get("natural") == "water" and tags.get("water") in ("lagoon", "lake", "river"):
            try:
                wkb = osmium.geom.WKBFactory().create_multipolygon(a)
            except Exception:
                return
            from shapely import wkb as shp_wkb

            geom = shp_wkb.loads(wkb, hex=True)
            if geom.intersects(FRAME) and geom.area > 2e-6:
                self.water.append(geom.intersection(FRAME))

    def node(self, n):
        place = n.tags.get("place")
        if place in ("suburb", "quarter", "neighbourhood") and FRAME.contains(Point(n.location.lon, n.location.lat)):
            self.places.append({"name": n.tags.get("name"), "kind": place, "at": xy(n.location.lon, n.location.lat)})


collect = Collect()
collect.apply_file(PBF, locations=True)


def project(geom):
    return ops.transform(lambda x, y, z=None: xy(x, y), geom)  # noqa: shapely.transform ne prend pas de fonction (x, y)


def path(geom, tol, digits=1):
    """Chemin SVG (d) d'une géométrie projetée, simplifiée."""
    g = geom.simplify(tol, preserve_topology=False)
    parts = []

    def ring(coords, close):
        pts = [f"{x:.{digits}f} {y:.{digits}f}" for x, y in coords]
        if len(pts) < 2:
            return
        parts.append("M" + "L".join(pts) + ("Z" if close else ""))

    def walk(g):
        if g.is_empty:
            return
        t = g.geom_type
        if t == "LineString":
            ring(g.coords, False)
        elif t == "Polygon":
            ring(g.exterior.coords, True)
            for i in g.interiors:
                ring(i.coords, True)
        else:
            for sub in g.geoms:
                walk(sub)

    walk(g)
    return "".join(parts)


view = box(0, 0, W, H)
out = {"width": W, "height": H, "metersPerUnit": METERS_PER_UNIT, "bbox": [WEST, SOUTH, EAST, NORTH]}

# Routes : fusionnées par classe, découpées au cadre.
tolerance = {"major": 0.8, "medium": 1.0, "minor": 2.2}
out["roads"] = {}
for cls, lines in collect.roads.items():
    merged = ops.linemerge(MultiLineString([project(l) for l in lines])).intersection(view)
    if cls == "minor":
        # Trame des petites rues : sans les impasses de moins de 25 unités (≈ 170 m), plus légère.
        merged = MultiLineString([g for g in getattr(merged, "geoms", [merged]) if g.geom_type == "LineString" and g.length > 25])
    out["roads"][cls] = path(merged, tolerance[cls], 0 if cls == "minor" else 1)

# Eaux : océan (côté sud du trait de côte), lagune et plans d'eau.
water = ops.unary_union([project(w) for w in collect.water]).intersection(view) if collect.water else Polygon()
ocean = Polygon()
if collect.coast:
    coast = ops.linemerge(MultiLineString([project(l) for l in collect.coast])).intersection(view)
    lines = [g for g in getattr(coast, "geoms", [coast]) if g.geom_type == "LineString"]
    # Trait de côte fragmenté (port, embouchure du chenal, côte sous le bord du cadre) : faces
    # découpées par la côte et le cadre ; sont océan celles qui contiennent un point connu en mer.
    faces = ops.polygonize(ops.unary_union([*lines, view.exterior]))
    probes = [Point(*xy(2.375, 6.3452)), Point(*xy(2.46, 6.351)), Point(*xy(2.468, 6.358))]
    ocean = ops.unary_union([f for f in faces if any(f.contains(p) for p in probes)])
    out["coast"] = path(coast, 0.8)
out["water"] = path(ops.unary_union([water, ocean]), 0.8)
out["places"] = [p for p in collect.places if p["name"]]


# ── Stations fictives et trajets (OSRM) ──────────────────────────────────────────────────────
def osrm(kind, coords, extra=""):
    url = f"{OSRM}/{kind}/v1/driving/" + ";".join(f"{lon:.6f},{lat:.6f}" for lon, lat in coords) + extra
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def snap(lon, lat):
    wp = osrm("nearest", [(lon, lat)])["waypoints"][0]["location"]
    return wp[0], wp[1]


def route(points, steps=False):
    r = osrm("route", points, f"?overview=full&geometries=geojson&steps={'true' if steps else 'false'}")["routes"][0]
    line = project(shape(r["geometry"]))
    res = {"d": path(line, 0.6), "durationS": round(r["duration"]), "distanceM": round(r["distance"])}
    if steps:
        res["steps"] = [
            {
                "type": s["maneuver"]["type"],
                "modifier": s["maneuver"].get("modifier"),
                "name": s.get("name") or "",
                "distanceM": round(s["distance"]),
                "at": xy(*s["maneuver"]["location"]),
            }
            for leg in r["legs"]
            for s in leg["steps"]
        ]
    return res


def meters(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1]) * METERS_PER_UNIT


# Position de l'utilisateur et stations (lon, lat approximatifs, recalés sur la route la plus proche).
spec_path = os.path.join(ROOT, "scripts", "city-stations.json")
spec = json.load(open(spec_path)) if os.path.exists(spec_path) else None
user = snap(*lonlat(*spec["user"])) if spec else None
stations = []
if spec:
  for s in spec["stations"]:
    lon, lat = snap(*lonlat(*s.pop("xy")))
    stations.append({**{k: v for k, v in s.items()}, "lonlat": [lon, lat], "at": xy(lon, lat), "distanceM": round(meters(xy(lon, lat), xy(*user)))})
  out["user"] = {"lonlat": list(user), "at": xy(*user)}
  out["stations"] = stations
  by_id = {s["id"]: s for s in stations}
  wander = [user] + [tuple(by_id[i]["lonlat"]) for i in spec["wander"]] + [snap(*lonlat(*spec["market"]))]
  out["wander"] = route(wander)
  out["wander"]["stops"] = [by_id[i]["at"] for i in spec["wander"]]
  out["market"] = xy(*wander[-1])
  # Destination : la station en stock la plus rapide à rejoindre dans le rayon de 2 km (comme l'app).
  candidates = [s for s in stations if s["status"] == "stock" and s["distanceM"] <= 2000]
  routes = {s["id"]: route([user, tuple(s["lonlat"])], steps=True) for s in candidates}
  for s in candidates:
      s["durationS"] = routes[s["id"]]["durationS"]
      s["routeDistanceM"] = routes[s["id"]]["distanceM"]
  best = min(candidates, key=lambda s: s["durationS"])
  out["route"] = routes[best["id"]]
  out["target"] = best["id"]

os.makedirs(os.path.join(ROOT, "src", "data"), exist_ok=True)
dest = os.path.join(ROOT, "src", "data", "city.json")
with open(dest, "w") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
# Version légère pour le navigateur (écran du téléphone, scènes) : sans la géométrie du fond de carte.
light = {k: v for k, v in out.items() if k not in ("roads", "water", "coast", "places")}
with open(os.path.join(ROOT, "src", "data", "city-points.json"), "w") as f:
    json.dump(light, f, ensure_ascii=False, separators=(",", ":"))
size = os.path.getsize(dest)
print(f"city.json {size // 1024} Ko — {W:.0f} × {H} unités, {METERS_PER_UNIT:.2f} m/unité")
for cls, d in out["roads"].items():
    print(f"  routes {cls}: {len(d) // 1024} Ko")
print(f"  eau {len(out['water']) // 1024} Ko, quartiers {len(out['places'])}, stations {len(stations)}")
if spec:
    print(f"  errance {out['wander']['distanceM']} m, itinéraire {out['route']['distanceM']} m / {out['route']['durationS']} s")
