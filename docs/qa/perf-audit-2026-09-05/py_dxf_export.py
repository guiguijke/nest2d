"""Estimation du coût export DXF (build_part) hors GridFS : 2 sources DXF
(hôte 1 anneau ext + 1 trou 64 seg, fan 19 sommets) via make_dxf du banc,
xref Loader par fichier, entity.copy()+transform+add_entity × N poses,
écriture texte. N = 590 / 509 (les deux tôles du rejeu user)."""
import io
import sys
import time

sys.path.insert(0, "/src/workers/nesting")
sys.path.insert(0, "/src/workers/common")
sys.path.insert(0, "/app")

import ezdxf
import ezdxf.xref
from ezdxf.math import Matrix44
from bench.seed_user_repro import filler_geometry, host_geometry, make_dxf

srcs = {}
for slug, (outer, holes) in [("piece_trou", host_geometry()), ("piece_fillx4", filler_geometry())]:
    dxf_bytes, handles = make_dxf([outer] + holes)
    doc = ezdxf.read(io.StringIO(dxf_bytes.decode("utf-8")))
    srcs[slug] = (doc, handles)
    print(slug, "handles", len(handles), "bytes", len(dxf_bytes))


def build(n_host, n_fan):
    t0 = time.perf_counter()
    new_doc = ezdxf.new()
    msp = new_doc.modelspace()
    plan = [("piece_trou", i) for i in range(n_host)] + [("piece_fillx4", i) for i in range(n_fan)]
    by_file = {}
    for slug, i in plan:
        by_file.setdefault(slug, []).append(i)
    t_loader = 0.0
    t_copy = 0.0
    for slug, poses in by_file.items():
        doc, handles = srcs[slug]
        ents = [doc.entitydb[h] for h in handles]
        t1 = time.perf_counter()
        loader = ezdxf.xref.Loader(doc, new_doc)
        loader.load_layers(list({e.dxf.layer for e in ents}))
        loader.execute()
        t_loader += time.perf_counter() - t1
        t1 = time.perf_counter()
        for i in poses:
            m = Matrix44.z_rotate(0.0) * Matrix44.translate(10.0 * i, 5.0 * i, 0)
            for e in ents:
                ne = e.copy()
                ne.transform(m)
                msp.add_entity(ne)
        t_copy += time.perf_counter() - t1
    t1 = time.perf_counter()
    s = io.StringIO()
    new_doc.write(s)
    t_write = time.perf_counter() - t1
    print(f"sheet {n_host}+{n_fan}: total {(time.perf_counter()-t0)*1e3:.0f} ms | loader {t_loader*1e3:.0f} ms | copy+transform+add {t_copy*1e3:.0f} ms | write {t_write*1e3:.0f} ms | {len(s.getvalue())/1024:.0f} KB")


build(81, 509)
build(19, 490)
