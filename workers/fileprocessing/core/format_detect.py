"""Source-format detection by CONTENT SIGNATURE — never by extension
(upload slugs historically all end in .dxf whatever the real format is).

Kept dependency-free on purpose: unit tests import this without pulling in
Mongo/GridFS.
"""


def detect_format(data: bytes) -> str:
    """Returns 'svg' | 'dwg' | 'dxf' from the first bytes of the upload."""
    head = data[:1024]
    if head[:4] == b"AC10":
        return "dwg"
    if b"<svg" in head[:512].lower():
        return "svg"
    return "dxf"
