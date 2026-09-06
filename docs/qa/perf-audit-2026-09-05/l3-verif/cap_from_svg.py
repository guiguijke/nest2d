import sys, re
sys.path.insert(0, '/app')
from shapely.geometry import Polygon
from core.capacity import capacity_report
num = r'-?\d+(?:\.\d+)?(?:e-?\d+)?'
def parse_d(dd):
    rings = []
    for sub in re.split(r'[Mm]', dd):
        pts = [(float(a), float(b)) for a, b in re.findall(r'(' + num + r')[ ,]+(' + num + r')', sub)]
        if len(pts) >= 3: rings.append(pts)
    return rings
svg = open('/svgs/alt0_grid_sheet1.svg', encoding='utf8').read()
ds = re.findall(r'<path[^>]* d="([^"]+)"', svg)
host = fan = None
for dd in ds:
    rings = parse_d(dd)
    if not rings: continue
    outer = max(rings, key=lambda r: abs(Polygon(r).area))
    a = abs(Polygon(outer).area)
    if a > 3000 and host is None: host = [list(p) for p in outer]
    elif 100 < a < 3000 and fan is None: fan = [list(p) for p in outer]
    if host and fan: break
print('host pts', len(host), 'area', round(abs(Polygon(host).area), 1), '| fan pts', len(fan), 'area', round(abs(Polygon(fan).area), 1))
parts = [{'coords': host, 'count': 100}, {'coords': fan, 'count': 800}]
for sp in (4.0, 3.0, 2.0, 0.1):
    r = capacity_report(parts, [{'width': 1000, 'height': 1000, 'count': 2}], sp)
    print(sp, {k: r.get(k) for k in ('refused', 'ratio', 'sheetsNeeded', 'constructive', 'maxSpacingForFitMm')}, 'maxParts', r.get('maxPartsAtSpacing'))
