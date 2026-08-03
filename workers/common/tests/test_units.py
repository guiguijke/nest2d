"""Unit tests for worker_common.geometry.units ($INSUNITS normalization)."""
import sys
from pathlib import Path

import ezdxf
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from worker_common.geometry.units import (
    insunits_code,
    insunits_to_mm,
    output_scale_and_headers,
)


def _doc_with_insunits(code):
    doc = ezdxf.new()
    if code is None:
        # Simulate a header without the variable at all.
        try:
            del doc.header["$INSUNITS"]
        except Exception:
            pass
    else:
        doc.header["$INSUNITS"] = code
    return doc


@pytest.mark.parametrize(
    "code,expected",
    [
        (0, 1.0),          # unitless -> historical mm behaviour
        (1, 25.4),         # inches
        (2, 304.8),        # feet
        (4, 1.0),          # millimeters
        (5, 10.0),         # centimeters
        (6, 1000.0),       # meters
        (8, 2.54e-5),      # microinches
        (9, 0.0254),       # mils
        (99, 1.0),         # unknown code -> mm + warning
        (None, 1.0),       # missing variable -> mm
    ],
)
def test_insunits_to_mm(code, expected):
    assert insunits_to_mm(_doc_with_insunits(code)) == pytest.approx(expected)


def test_insunits_code_reads_header():
    assert insunits_code(_doc_with_insunits(1)) == 1
    assert insunits_code(_doc_with_insunits(0)) == 0


def test_output_scale_and_headers_mm():
    scale, insunits, measurement = output_scale_and_headers("mm")
    assert scale == 1.0
    assert insunits == 4
    assert measurement == 1


def test_output_scale_and_headers_inch():
    scale, insunits, measurement = output_scale_and_headers("inch")
    assert scale == pytest.approx(1.0 / 25.4)
    assert insunits == 1
    assert measurement == 0


def test_output_scale_and_headers_unknown_defaults_mm():
    # Legacy jobs without outputUnit, or unexpected values, must export mm.
    assert output_scale_and_headers(None) == output_scale_and_headers("mm")
    assert output_scale_and_headers("cubits") == output_scale_and_headers("mm")
