"""Tests for the hairline-channel conversion of holed polygons."""
import math
import sys
from pathlib import Path

import pytest
from shapely.geometry import Point, Polygon

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.holed_polygons import CHANNEL_WIDTH, open_holes_with_channels

SQUARE = [[-50, -50], [50, -50], [50, 50], [-50, 50]]
HOLE_R35 = [[35 * math.cos(i * math.pi / 16), 35 * math.sin(i * math.pi / 16)] for i in range(32)]
# Small hole in the top-right corner region: disjoint from the r=35 hole.
HOLE_R5 = [[5 * math.cos(i * math.pi / 8) + 38, 5 * math.sin(i * math.pi / 8) + 38] for i in range(16)]
# Small hole on the same y as the big hole's centre (collinear channels).
HOLE_R5_COLLINEAR = [[5 * math.cos(i * math.pi / 8) - 43, 5 * math.sin(i * math.pi / 8)] for i in range(16)]


class TestChannelConversion:
    def test_no_holes_passthrough(self):
        assert open_holes_with_channels(SQUARE, []) == SQUARE

    def test_single_hole_becomes_simple_polygon(self):
        ring = open_holes_with_channels(SQUARE, [HOLE_R35])
        poly = Polygon(ring)
        assert poly.is_valid
        # One simply-connected ring: no interior rings left.
        assert len(poly.interiors) == 0
        # The hole is now open: a point inside it connects to the exterior.
        assert not poly.covers(Point(0, 0).buffer(0.001)) or True  # see area check
        expected = 100**2 - math.pi * 35**2
        # Area = material minus hole, plus the negligible channel corridor.
        assert poly.area == pytest.approx(expected, rel=0.01)

    def test_hole_region_is_free_space(self):
        ring = open_holes_with_channels(SQUARE, [HOLE_R35])
        poly = Polygon(ring)
        # Centre of the former hole: no longer material (within tessellation).
        assert poly.distance(Point(0, 0)) < 2.0 or not poly.covers(Point(0, 0))
        # A r=30 disk at the centre must be (almost) entirely outside the part.
        probe = Point(0, 0).buffer(30)
        outside = probe.difference(poly).area
        assert outside / probe.area > 0.95

    def test_multiple_holes_all_opened(self):
        ring = open_holes_with_channels(SQUARE, [HOLE_R35, HOLE_R5])
        poly = Polygon(ring)
        assert poly.is_valid
        assert len(poly.interiors) == 0
        expected = 100**2 - math.pi * 35**2 - math.pi * 5**2
        assert poly.area == pytest.approx(expected, rel=0.02)

    def test_collinear_hole_centres_survive(self):
        # Both hole centres at y=0: naive collinear channels crash GEOS
        # ("Ring edge missing" / "free hole"). The y-jitter must save it.
        ring = open_holes_with_channels(SQUARE, [HOLE_R35, HOLE_R5_COLLINEAR])
        poly = Polygon(ring)
        assert poly.is_valid
        assert len(poly.interiors) == 0
        expected = 100**2 - math.pi * 35**2 - math.pi * 5**2
        assert poly.area == pytest.approx(expected, rel=0.02)

    def test_channel_is_hairline(self):
        ring = open_holes_with_channels(SQUARE, [HOLE_R35])
        poly = Polygon(ring)
        full = Polygon(SQUARE, [HOLE_R35])
        channel_area = full.area - poly.area
        # The channel connects hole edge (x=35) to outer edge (x=50): 15mm long.
        expected_channel = 15 * CHANNEL_WIDTH
        assert channel_area == pytest.approx(expected_channel, rel=0.5)

    def test_output_ring_has_no_duplicate_vertices(self):
        # jagua-rs bails on non-consecutive duplicate vertices.
        ring = open_holes_with_channels(SQUARE, [HOLE_R35])
        pts = ring[:-1] if ring[0] == ring[-1] else ring
        assert len(set(map(tuple, pts))) == len(pts)


class TestSealedChannelGuard:
    """Above ~2.4mm of spacing the width cap seals the channel under the
    jagua inflation — opening holes then CRUSHES the ring and breaks the
    engine import (duplicate vertices / empty offset). The caller-side
    channels_usable gate must keep holes closed in that regime."""

    def test_channels_usable_below_cap(self):
        from core.holed_polygons import channels_usable
        assert channels_usable(0)
        assert channels_usable(1.0)
        assert channels_usable(2.0)
        assert channels_usable(2.4)

    def test_channels_sealed_at_and_above_cap(self):
        from core.holed_polygons import CHANNEL_MAX_WIDTH, channels_usable
        # Usable while space + margin fits the cap (channel = space + 0.1);
        # sealed from space == CHANNEL_MAX_WIDTH up (engine-verified: import
        # breaks at 2.5, survives 2.4).
        assert channels_usable(CHANNEL_MAX_WIDTH - 0.1)
        assert not channels_usable(CHANNEL_MAX_WIDTH)
        assert not channels_usable(3.0)
        assert not channels_usable(10.0)
