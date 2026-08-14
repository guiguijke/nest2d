"""Lock test for the Phase 2 local-compute branch: when a job carries
`params.computeLocation == "local"`, nesting_process must ONLY prepare the
exact engine payload (instance + config, deterministic seed) and mark the job
`awaiting_local` — never call run_engine, never acquire a compute token.

Run: PYTHONPATH=workers/common:workers/nesting python -m pytest workers/nesting/tests/test_local_compute.py -q
"""
import math
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "common"))

# worker_common.mongo connects at import time — stub before importing main.
sys.modules.setdefault(
    "worker_common.mongo",
    types.SimpleNamespace(db=None, get_bucket=lambda name: None),
)

import core.main as m


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self.sets = []
        self.unsets = []

    def update_one(self, filter, update, *a, **kw):
        doc = next((d for d in self.docs if d.get("_id") == filter.get("_id") or d.get("slug") == filter.get("slug")), self.docs[0] if self.docs else None)
        if doc is None:
            return
        for k, v in update.get("$set", {}).items():
            parts = k.split(".")
            t = doc
            for p in parts[:-1]:
                t = t.setdefault(p, {})
            t[parts[-1]] = v
        for k in update.get("$unset", {}).keys():
            self.unsets.append(k)
            doc.pop(k, None)
        self.sets.append(update.get("$set", {}))

    def find_one(self, filter, *a, **kw):
        return next((d for d in self.docs if d.get("_id") == filter.get("_id")), None)


class FakeDb(dict):
    def __getitem__(self, name):
        if name not in self:
            self[name] = FakeCollection()
        return dict.__getitem__(self, name)


def _job_doc():
    return {
        "_id": "job1",
        "slug": "local-job-1",
        "projectSlug": "p1",
        "ownerId": "u1",
        "status": "processing",
        "files": [{"slug": "f1", "count": 4, "rotations": [0.0, 90.0, 180.0, 270.0]}],
        "params": {
            "sheets": [{"width": 1500.0, "height": 1000.0, "count": 1}],
            "space": 2.0,
            "fillHoles": True,
            "timeBudgetSec": 13,  # browser profile written at enqueue (server)
            "alternativesCount": 1,
            "directions": ["left"],
            "vcores": 1,
            "computeLevel": "browser",
            "computeLocation": "local",
        },
    }


def _square(cx, cy, s):
    return [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s], [cx - s, cy - s]]


def _ring(r, n=32):
    pts = [[r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)] for i in range(n)]
    pts.append(pts[0])
    return pts


def test_local_job_is_prepared_not_solved(monkeypatch):
    jobs = FakeCollection([_job_doc()])
    fake_db = FakeDb(nesting_jobs=jobs)
    monkeypatch.setattr(m, "db", fake_db)
    monkeypatch.setattr(m, "get_dek", lambda db, owner: None)
    monkeypatch.setattr(
        m,
        "convert_files_to_input_items",
        lambda files, dek: [
            {"id": 0, "file_slug": "f1", "coords": _square(0, 0, 40), "holes": [],
             "handles": ["A1", "B2"], "color": "#123456",
             "count": 4, "rotations": [0.0, 90.0, 180.0, 270.0]}
        ],
    )

    def forbidden_run_engine(*a, **kw):
        raise AssertionError("run_engine must never run for a local job")

    monkeypatch.setattr(m, "run_engine", forbidden_run_engine)

    m.nesting_process(jobs.docs[0])

    doc = jobs.docs[0]
    assert doc["status"] == "awaiting_local"
    payload = doc["localPayload"]
    assert payload["problem"] == "spp"
    assert payload["instance"]["strip_height"] == 1000.0
    assert len(payload["instance"]["items"]) == 1
    cfg = payload["engineConfig"]
    assert cfg["time_budget_sec"] == 13
    assert isinstance(cfg["prng_seed"], int) and cfg["prng_seed"] > 0
    # J-083 : instance triviale (1 pièce ×4, 20 sommets) ⇒ patience courte,
    # pas le plancher historique de 12 s qui brûlait tout le budget navigateur.
    assert cfg["plateau_patience_sec"] <= 3.0
    # J-083/#14c : profil navigateur mono-walk — wasm n'a pas de threads OS,
    # le multi-start y serait séquentiel (temps mur multiplié sans gain).
    assert cfg["n_workers"] == 1
    assert cfg["separator_workers"] == 1
    # J-082: the browser builds its own artifacts (SVG/report/DXF) — it needs
    # the same per-item data the server finalization uses: clean coords+holes,
    # display color, source file slug and DXF entity handles (copy by handle).
    parts = payload["parts"]
    assert parts == [{
        "id": 0, "file_slug": "f1", "handles": ["A1", "B2"],
        "color": "#123456", "coords": _square(0, 0, 40), "holes": [],
        "count": 4,
    }]
    # Live progress was cleaned for the handoff.
    assert "progress" in jobs.unsets
    # itemMap is still written during prep (the modal/live view needs it).
    assert any("itemMap" in s for s in jobs.sets)


def test_local_holes_meta_prepass_keeps_instance_importable(monkeypatch):
    """Prod regression 2026-08-09 (J-085) : filler uploadé EN PREMIER (id 0)
    et tous les fillers tiennent dans les meta-slots (remaining=0). jagua
    droppe les items à demande 0 puis exige des ids consécutifs depuis 0 —
    sans réindexation, l'import casse (« consecutive IDs ») et le job échoue,
    serveur comme navigateur. Le verrou : l'instance réduite ne porte que
    l'hôte, réindexé 0, trous fermés, avec l'idMap de re-mapping."""
    jobs = FakeCollection([_job_doc()])
    fake_db = FakeDb(nesting_jobs=jobs)
    monkeypatch.setattr(m, "db", fake_db)
    monkeypatch.setattr(m, "get_dek", lambda db, owner: None)
    monkeypatch.setattr(
        m,
        "convert_files_to_input_items",
        lambda files, dek: [
            # carré 10×10 posé dans un quadrant (coin en (1.5,1.5)) : les 4
            # rotations pinwheel laissent ~3 mm d'espacement → capacité 4.
            {"id": 0, "file_slug": "fill", "coords": _square(6.5, 6.5, 5), "holes": [],
             "handles": [], "color": None, "count": 1,
             "rotations": [0.0, 90.0, 180.0, 270.0]},
            {"id": 1, "file_slug": "host", "coords": _square(0, 0, 50), "holes": [_ring(35.0)],
             "handles": [], "color": None, "count": 1,
             "rotations": [0.0, 90.0, 180.0, 270.0]},
        ],
    )

    def forbidden_run_engine(*a, **kw):
        raise AssertionError("run_engine must never run for a local job")

    monkeypatch.setattr(m, "run_engine", forbidden_run_engine)

    m.nesting_process(jobs.docs[0])

    payload = jobs.docs[0]["localPayload"]
    items = payload["instance"]["items"]
    # Un seul item résolu : l'hôte, réindexé 0 (jagua l'exige), demande pleine.
    assert [i["id"] for i in items] == [0]
    assert items[0]["demand"] == 1
    # Hôte résolu trous FERMÉS : shape = anneau externe propre, sans canal —
    # sinon le moteur placerait les fillers restants dans des trous que
    # l'expansion remplit ensuite (double-remplissage = overlaps réels).
    assert items[0]["shape"]["data"] == _square(0, 0, 50)
    meta = payload["meta"]
    assert meta["idMap"] == [1]  # id réduit 0 → id d'origine 1
    assert meta["host"] == 1 and meta["fill"] == 0
    assert meta["slots"] == [1]
    # Petit carré dans un trou Ø70 à space 2 : pinwheel plein validé.
    assert len(meta["ringRotations"][0]) == 4


def test_adaptive_plateau_patience():
    """J-083 : la patience suit la taille de l'instance, pas un plancher fixe."""
    p = m.adaptive_plateau_patience_sec
    # Job trivial navigateur (4 pièces, ~20 sommets, sans trous) : ~2 s,
    # surtout PAS le plancher historique de 12 s.
    assert p(13, 4, 20, False) <= 2.5
    # Plancher : même vide, on confirme le plateau (>= 2 s).
    assert p(13, 0, 0, False) == 2.0
    # Trous : prime proportionnelle — quasi nulle sur un petit job (qui
    # converge vite quand même), pleine dès qu'il y a de la matière.
    assert p(13, 4, 20, True) < p(13, 4, 20, False) + 1.0
    assert p(300, 60, 5000, True) - p(300, 60, 5000, False) == 3.0
    # Instance dense : la patience monte avec les sommets placés…
    assert p(300, 200, 30000, True) > p(300, 10, 500, True)
    # …plafonnée à 30 s, et jamais au-delà du budget mur.
    assert p(300, 10000, 10_000_000, True) == 30.0
    assert p(3, 100, 100000, True) == 3.0


def test_server_job_runs_normally(monkeypatch):
    """Regression: WITHOUT computeLocation the prep never short-circuits."""
    doc = _job_doc()
    del doc["params"]["computeLocation"]
    doc["params"]["timeBudgetSec"] = 3  # short server budget for the test
    jobs = FakeCollection([doc])
    monkeypatch.setattr(m, "db", FakeDb(nesting_jobs=jobs))
    monkeypatch.setattr(m, "get_dek", lambda db, owner: None)
    monkeypatch.setattr(
        m,
        "convert_files_to_input_items",
        lambda files, dek: [
            {"id": 0, "file_slug": "f1", "coords": _square(0, 0, 40), "holes": [], "count": 4, "rotations": [0.0, 90.0, 180.0, 270.0]}
        ],
    )
    called = {}

    def fake_run_engine(instance, config, problem_type, on_event=None, should_cancel=None, **_kw):
        called["yes"] = True
        # Simulate the engine raising infeasible so nesting_process exits the
        # engine stage quickly (we only assert it was REACHED).
        raise Exception("no feasible solution: fake")

    monkeypatch.setattr(m, "run_engine", fake_run_engine)
    try:
        m.nesting_process(jobs.docs[0])
    except Exception:
        pass  # the infeasible path marks the job error — fine for this lock
    assert called.get("yes") is True
    assert jobs.docs[0].get("status") != "awaiting_local"
