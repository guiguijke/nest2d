"""Lock test for the Phase 2 local-compute branch: when a job carries
`params.computeLocation == "local"`, nesting_process must ONLY prepare the
exact engine payload (instance + config, deterministic seed) and mark the job
`awaiting_local` — never call run_engine, never acquire a compute token.

Run: PYTHONPATH=workers/common:workers/nesting python -m pytest workers/nesting/tests/test_local_compute.py -q
"""
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


def test_local_job_is_prepared_not_solved(monkeypatch):
    jobs = FakeCollection([_job_doc()])
    fake_db = FakeDb(nesting_jobs=jobs)
    monkeypatch.setattr(m, "db", fake_db)
    monkeypatch.setattr(m, "get_dek", lambda db, owner: None)
    monkeypatch.setattr(
        m,
        "convert_files_to_input_items",
        lambda files, dek: [
            {"id": 0, "file_slug": "f1", "coords": _square(0, 0, 40), "holes": [], "count": 4, "rotations": [0.0, 90.0, 180.0, 270.0]}
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
    # Live progress was cleaned for the handoff.
    assert "progress" in jobs.unsets
    # itemMap is still written during prep (the modal/live view needs it).
    assert any("itemMap" in s for s in jobs.sets)


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

    def fake_run_engine(instance, config, problem_type, on_event=None, should_cancel=None):
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
