from dataclasses import dataclass
from typing import Dict, List, Tuple

from worker_common.geometry.dxf_parser import convert_entity_to_shapely

from ezdxf.document import Drawing
# Use the top-level shapely (2.0) functions — `shapely.ops.unary_union` does not
# support the `grid_size` argument.
from shapely import STRtree, set_precision, unary_union
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import polygonize

from worker_common.logger import setup_logger

logger = setup_logger("build_geometry")

# Coordinate grid used to make near-coincident vertices exactly equal. This makes
# noding/polygonize robust (closes hairline gaps at corners) and lets unary_union
# reliably dissolve the shared edges of faces that an internal line split apart.
# Far below the flattening tolerance, so it does not affect contour accuracy.
GRID_SIZE = 1e-4

# Parts whose contours are this close (mm) or closer are merged into one polygon.
MERGE_DISTANCE = 0.1


def collect_footprints(drawing: Drawing, tolerance: float) -> List[Tuple[str, BaseGeometry]]:
    """(handle, geometry) for every convertible entity of the drawing.
    Used to attach original DXF handles to the part that contains them
    (outlines, holes, points, annotations, ...)."""
    msp = drawing.modelspace()
    footprints: List[Tuple[str, BaseGeometry]] = []
    for entity in msp:
        try:
            dxf_geometry = convert_entity_to_shapely(entity, tolerance)
        except Exception:
            # convert_entity_to_shapely already logs; unconvertible entities
            # simply carry no footprint.
            continue
        if dxf_geometry is None:
            continue
        geom = dxf_geometry.geometry
        if geom.is_empty:
            continue
        footprints.append((dxf_geometry.handle, geom))
    return footprints


def _merge_near_polygons(polygons: List[Polygon], distance: float) -> List[Polygon]:
    """
    Merge polygons that lie within `distance` of each other into single polygons.

    Polygons are clustered by proximity (union-find over pairwise distance). Each
    cluster of more than one polygon is welded into a single body with a
    morphological close (buffer out then in, mitre joins to keep corners sharp).
    Interior rings (holes) are preserved by the weld; only holes narrower than
    2 × distance can collapse, which is below any useful cutout size.
    Isolated polygons are returned untouched so their contours stay exact.
    """
    count = len(polygons)
    if count <= 1:
        return polygons

    parent = list(range(count))

    def find(node):
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return parent[node]

    def union(a, b):
        root_a, root_b = find(a), find(b)
        if root_a != root_b:
            parent[root_a] = root_b

    for i in range(count):
        for j in range(i + 1, count):
            if polygons[i].distance(polygons[j]) <= distance:
                union(i, j)

    clusters = {}
    for i in range(count):
        clusters.setdefault(find(i), []).append(i)

    result: List[Polygon] = []
    for indices in clusters.values():
        if len(indices) == 1:
            result.append(polygons[indices[0]])
            continue

        group_union = unary_union([polygons[k] for k in indices])
        # Bridge the sub-distance gaps so the cluster becomes one body. The
        # buffer round-trip keeps interior rings (they shrink by `distance`).
        bridged = (
            group_union
            .buffer(distance, join_style="mitre", mitre_limit=5.0)
            .buffer(-distance, join_style="mitre", mitre_limit=5.0)
        )
        for geom in getattr(bridged, "geoms", [bridged]):
            if geom.geom_type == "Polygon" and not geom.is_empty:
                result.append(geom)

    return result


def _ring_key(ring) -> frozenset:
    """Canonical key for a closed ring, insensitive to start point, winding
    and (after grid rounding) to which side of the edge generated it. Two
    faces sharing an edge report the same cycle with the same key."""
    return frozenset(
        (round(x, 4), round(y, 4)) for x, y in ring.coords
    )


def _unique_ring_polygons(faces: List[Polygon]) -> List[Polygon]:
    """All distinct boundary cycles of the faces, as solid polygons.

    Every face contributes its exterior ring and its interior rings; the same
    cycle appears twice (once per adjacent face) and is deduplicated. These
    cycles are the basis of the even-odd containment rule below.
    """
    seen = set()
    rings: List[Polygon] = []
    for face in faces:
        for cycle in [face.exterior, *face.interiors]:
            key = _ring_key(cycle)
            if key in seen:
                continue
            seen.add(key)
            ring_poly = Polygon(cycle)
            if not ring_poly.is_empty and ring_poly.area > 1e-10:
                rings.append(ring_poly)
    return rings


def _material_faces(faces: List[Polygon]) -> List[Polygon]:
    """Selects the faces that represent actual material.

    Cutting semantics follow the even-odd rule: a region enclosed by an odd
    number of closed contours is material, an even number is a void (hole).
    A disk inside a square is a hole; an island inside that hole is material
    again (a separate part). The containment depth of each face is counted
    over the unique boundary cycles of the planar graph.
    """
    if len(faces) <= 1:
        return faces

    rings = _unique_ring_polygons(faces)
    ring_tree = STRtree(rings)

    material = []
    for face in faces:
        probe = face.representative_point()
        depth = 0
        for ring_idx in ring_tree.query(probe):
            if rings[ring_idx].contains(probe):
                depth += 1
        if depth % 2 == 1:
            material.append(face)
        else:
            logger.info(
                "Void region detected (hole)",
                extra={"area": face.area},
            )
    return material


@dataclass(slots=True)
class ClosedPolygon:
    geometry: Polygon
    handles: List[str]

    def to_mongo_dict(self) -> Dict[str, List[List[float]]] :
        if not isinstance(self.geometry, Polygon):
            raise TypeError("The 'geometry' attribute must be a shapely Polygon.")

        bounding_box = self.geometry.bounds

        width = bounding_box[2] - bounding_box[0]
        height = bounding_box[3] - bounding_box[1]

        if (abs(width) < 0.1 or abs(height) < 0.1):
            return None

        def reduce_ring(ring) -> List[List[float]]:
            coords = list(zip(*ring.coords.xy))
            if not coords:
                return []
            reduced = [coords[0]]
            for point in coords[1:]:
                last = reduced[-1]
                if abs(point[0] - last[0]) > 0.01 or abs(point[1] - last[1]) > 0.01:
                    reduced.append(point)
            return [[p[0], p[1]] for p in reduced]

        exterior_coords = reduce_ring(self.geometry.exterior)
        hole_rings = [
            ring for ring in (reduce_ring(interior) for interior in self.geometry.interiors)
            if len(ring) >= 3
        ]

        return {
            'coordinates': exterior_coords,
            # Interior rings (cutouts). Empty for legacy readers, which all
            # access it via .get() — the nesting post-pass uses them to place
            # small parts inside the holes of placed parts.
            'holes': hole_rings,
            'handles': self.handles,
            'width': width,
            'height': height
        }


def build_geometry(drawing: Drawing, tolerance: float) -> List[ClosedPolygon]:
    """
    Build accurate part contours from a DXF drawing.

    Unlike the former convex-hull based approach, this follows the real
    geometry:
      * Every entity is flattened to linework; closed contours and open
        segments are noded together and polygonized to recover the faces they
        enclose.
      * Faces are filtered by the even-odd rule: regions enclosed an even
        number of times are voids (holes) and are subtracted, so parts keep
        their concavities AND their cutouts.
      * Material faces are dissolved into one body per disjoint part; bodies
        closer than MERGE_DISTANCE are welded together.

    Original DXF handles are preserved: every entity whose bounding-box
    centre falls inside a part's silhouette (holes included) is attached to
    that part — smallest containing silhouette wins, so islands nested in a
    hole keep their own entities while the hole's contour travels with the
    enclosing part.
    """
    msp = drawing.modelspace()

    linework: List[LineString] = []
    footprints: List[Tuple[str, BaseGeometry]] = []

    for entity in msp:
        try:
            dxf_geometry = convert_entity_to_shapely(entity, tolerance)
        except Exception as e:
            logger.error("Error converting entity", extra={
                "entity": entity.dxftype(),
                "handle": entity.dxf.handle,
                "error": str(e),
            })
            raise e

        if dxf_geometry is None:
            continue

        geometry = dxf_geometry.geometry
        if geometry.is_empty:
            continue

        footprints.append((dxf_geometry.handle, geometry))

        if geometry.geom_type == "Polygon":
            # Closed contours contribute their boundary to the planar graph;
            # whether the enclosed region is material or a hole is decided
            # later by the even-odd rule.
            linework.append(LineString(geometry.exterior.coords))
        elif geometry.geom_type == "LineString":
            linework.append(geometry)
        # Point geometries carry no contour; their footprint is enough.

    if not linework:
        logger.info("No linework found")
        return []

    # Snap coordinates to a fine grid so coincident endpoints become exactly
    # equal — this nodes the linework robustly and closes hairline corner gaps
    # without perturbing edges that faces share (which `snap` would break).
    merged_lines = set_precision(unary_union(linework), GRID_SIZE)
    noded = unary_union(merged_lines)
    faces = list(polygonize(noded))
    logger.info("Recovered faces from linework", extra={"len": len(faces)})

    if not faces:
        logger.info("No closed polygons found")
        return []

    material = _material_faces(faces)
    if not material:
        logger.info("No material faces found")
        return []

    # buffer(0) repairs self-intersections / winding before merging.
    cleaned = [poly.buffer(0) for poly in material if not poly.is_empty]
    cleaned = [
        geom
        for poly in cleaned
        for geom in getattr(poly, "geoms", [poly])
        if geom.geom_type == "Polygon" and not geom.is_empty
    ]
    # grid_size makes the overlay robust so faces that an internal line split
    # into several pieces are dissolved back into a single body per part;
    # holes (void faces) survive as interior rings.
    merged = unary_union(cleaned, grid_size=GRID_SIZE)

    bodies = [
        geom
        for geom in getattr(merged, "geoms", [merged])
        if geom.geom_type == "Polygon" and not geom.is_empty
    ]

    # Merge parts whose contours are within MERGE_DISTANCE of each other.
    bodies = _merge_near_polygons(bodies, MERGE_DISTANCE)

    # Attach handles. An entity belongs to the part whose MATERIAL body its
    # "ink" touches: closed contours draw their outline (not a filled disk),
    # so a hole's circle touches the enclosing part's boundary — not an
    # island sitting inside that hole. Entities in a void (points,
    # annotations inside a hole) fall back to the smallest silhouette
    # containing them.
    silhouettes = [(body, Polygon(body.exterior)) for body in bodies]
    probe_tol = max(tolerance, 1e-6)

    def attachment_hits(body, geom):
        try:
            inter = body.intersection(geom)
        except Exception:
            return 0.0
        # Ink is 1-dimensional: length is the primary measure, area the
        # fallback for filled shapes.
        return inter.length if inter.length > 0 else inter.area

    result: List[ClosedPolygon] = []
    assigned = {i: [] for i in range(len(silhouettes))}
    for handle, geom in footprints:
        ink = geom.boundary if geom.geom_type == "Polygon" else geom
        hits = [
            (idx, attachment_hits(body, ink))
            for idx, (body, _silhouette) in enumerate(silhouettes)
            if body.buffer(probe_tol).intersects(ink)
        ]
        hits = [(idx, measure) for idx, measure in hits if measure > 0]
        if hits:
            # The part the entity contributes most to (a long line crossing
            # two parts attaches to the part it mostly draws).
            best_idx = max(hits, key=lambda entry: entry[1])[0]
        else:
            # In a void: smallest containing silhouette wins.
            centre = geom if geom.geom_type == "Point" else geom.centroid
            candidates = [
                (idx, silhouette.area)
                for idx, (_body, silhouette) in enumerate(silhouettes)
                if silhouette.buffer(probe_tol).intersects(centre)
            ]
            best_idx = min(candidates, key=lambda entry: entry[1])[0] if candidates else None
        if best_idx is not None:
            assigned[best_idx].append(handle)

    for idx, (body, _silhouette) in enumerate(silhouettes):
        result.append(ClosedPolygon(geometry=body, handles=assigned[idx]))

    logger.info(
        "Computed closed polygons",
        extra={"len": len(result), "with_holes": sum(1 for cp in result if cp.geometry.interiors)},
    )

    return result
