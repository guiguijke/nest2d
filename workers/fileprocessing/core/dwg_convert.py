"""DWG -> DXF conversion via GNU LibreDWG's `dwgread` CLI (GPL v3).

DWG is a closed binary format no mature Python library reads. `dwgread`
runs as a plain subprocess ("mere aggregation" — our code never links
against it), converts locally inside the container (no external service,
vault/privacy safe), and writes a DXF that the normal pipeline then reads.

When the binary is missing (image built without LibreDWG) or the file is
unreadable (too recent, corrupted, R2013+ experimental), the error is
explicit and actionable — never silent garbage.
"""
import os
import subprocess
import tempfile

from worker_common.logger import setup_logger

logger = setup_logger("dwg_convert")

DWGREAD_BIN = os.environ.get("DWGREAD_BIN", "dwgread")
CONVERT_TIMEOUT_SEC = int(os.environ.get("DWG_CONVERT_TIMEOUT", "60"))


class DwgConversionError(Exception):
    """Raised when a DWG cannot be converted — shown to the user as the
    file-processing failure reason."""


def dwg_bytes_to_dxf_bytes(dwg_bytes: bytes) -> bytes:
    """Converts DWG bytes to DXF bytes via dwgread. Raises
    DwgConversionError with a user-readable message on any failure."""
    with tempfile.TemporaryDirectory() as tmpdir:
        src = os.path.join(tmpdir, "input.dwg")
        dst = os.path.join(tmpdir, "output.dxf")
        with open(src, "wb") as f:
            f.write(dwg_bytes)
        try:
            result = subprocess.run(
                [DWGREAD_BIN, "-O", "DXF", "-o", dst, src],
                capture_output=True,
                timeout=CONVERT_TIMEOUT_SEC,
            )
        except FileNotFoundError:
            raise DwgConversionError(
                "DWG files are not supported on this server (converter missing) — "
                "please export your file as DXF and upload it again."
            )
        except subprocess.TimeoutExpired:
            raise DwgConversionError(
                "DWG conversion timed out — the file may be too complex. "
                "Please export it as DXF and upload it again."
            )

        if result.returncode != 0 or not os.path.exists(dst):
            tail = (result.stderr or b"").decode("utf-8", "ignore")[-300:]
            logger.error("dwgread failed", extra={"rc": result.returncode, "stderr": tail})
            raise DwgConversionError(
                "Could not read this DWG file (recent or unsupported version). "
                "Please export it as DXF (R2000 or later) and upload it again."
            )

        with open(dst, "rb") as f:
            dxf = f.read()

    logger.info("DWG converted", extra={"dxf_bytes": len(dxf)})
    return dxf
