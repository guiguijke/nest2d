"""DWG conversion (dwgread subprocess): unit tests with a mocked binary +
integration test gated on the real converter (fixture DWG written by
dwgwrite at test time — no licensing question on fixtures)."""
import shutil
import subprocess
import sys
from pathlib import Path
from unittest import mock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.dwg_convert import DwgConversionError, dwg_bytes_to_dxf_bytes

HAS_DWGREAD = shutil.which("dwgread") is not None
HAS_DWGWRITE = shutil.which("dwgwrite") is not None


class TestDwgErrors:
    def test_missing_binary_is_actionable(self):
        with mock.patch("core.dwg_convert.subprocess.run", side_effect=FileNotFoundError):
            with pytest.raises(DwgConversionError, match="not supported on this server"):
                dwg_bytes_to_dxf_bytes(b"AC1027fake")

    def test_failed_conversion_is_actionable(self, tmp_path):
        def fake_run(cmd, capture_output, timeout):
            return subprocess.CompletedProcess(cmd, 1, stdout=b"", stderr=b"garbage input")
        with mock.patch("core.dwg_convert.subprocess.run", side_effect=fake_run):
            with pytest.raises(DwgConversionError, match="Could not read this DWG"):
                dwg_bytes_to_dxf_bytes(b"AC1027fake")

    def test_timeout_is_actionable(self):
        with mock.patch(
            "core.dwg_convert.subprocess.run",
            side_effect=subprocess.TimeoutExpired(cmd="dwgread", timeout=60),
        ):
            with pytest.raises(DwgConversionError, match="timed out"):
                dwg_bytes_to_dxf_bytes(b"AC1027fake")


@pytest.mark.skipif(not HAS_DWGREAD, reason="dwgread (LibreDWG) not installed on this host")
class TestDwgIntegration:
    def test_invalid_dwg_is_rejected_cleanly(self):
        with pytest.raises(DwgConversionError):
            dwg_bytes_to_dxf_bytes(b"AC1027 definitely not a real dwg")

    @pytest.mark.skipif(not HAS_DWGWRITE, reason="dwgwrite not installed on this host")
    def test_roundtrip_fixture_generated_by_dwgwrite(self, tmp_path):
        """dwgwrite builds a DWG from a DXF R2000; dwgread must read it back
        with the entities intact (line + circle)."""
        dxf = tmp_path / "fixture.dxf"
        dxf.write_text(
            "0\nSECTION\n2\nENTITIES\n"
            "0\nLINE\n8\n0\n10\n0.0\n20\n0.0\n11\n100.0\n21\n50.0\n"
            "0\nCIRCLE\n8\n0\n10\n50.0\n20\n50.0\n40\n25.0\n"
            "0\nENDSEC\n0\nEOF\n",
            encoding="ascii",
        )
        dwg = tmp_path / "fixture.dwg"
        subprocess.run(
            ["dwgwrite", "-O", "DWG", "-o", str(dwg), str(dxf)],
            check=True, capture_output=True, timeout=60,
        )
        out = dwg_bytes_to_dxf_bytes(dwg.read_bytes())
        assert b"LINE" in out
        assert b"CIRCLE" in out
