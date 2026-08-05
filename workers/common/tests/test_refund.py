"""Lock test for D-PAY-3: the quota consumed at enqueue is refunded by the
worker when the nesting definitively fails ("10 nestings RÉUSSIS" — failed
jobs must not burn free/demo slots).

Run: PYTHONPATH=workers/common python -m pytest workers/common/tests/test_refund.py -q
"""
import sys
import types

# worker_common.mongo connects at import time — stub it before importing
# refund (tests monkeypatch refund.db anyway).
sys.modules.setdefault("worker_common.mongo", types.SimpleNamespace(db=None))

import worker_common.refund as refund


class FakeCollection:
    def __init__(self, docs):
        self.docs = docs
        self.calls = []

    @staticmethod
    def _match(doc, filter):
        for key, val in filter.items():
            if isinstance(val, dict):
                for op, arg in val.items():
                    if op == "$gt" and not (doc.get(key) is not None and doc.get(key) > arg):
                        return False
                    if op != "$gt":
                        raise AssertionError(f"unsupported operator {op}")
            elif doc.get(key) != val:
                return False
        return True

    def update_one(self, filter, update):
        self.calls.append((filter, update))
        doc = next((d for d in self.docs if self._match(d, filter)), None)
        if doc is not None:
            for key, val in update.get("$inc", {}).items():
                doc[key] = doc.get(key, 0) + val
            for key, val in update.get("$set", {}).items():
                # minimal dotted-path support ('charge.refunded')
                parts = key.split(".")
                target = doc
                for p in parts[:-1]:
                    target = target.setdefault(p, {})
                target[parts[-1]] = val
        return doc


class FakeDb(dict):
    def __getitem__(self, name):
        if name not in self:
            self[name] = FakeCollection([])
        return dict.__getitem__(self, name)


def job(charge_type, owner="u1", **kw):
    return {"_id": "j1", "ownerId": owner, "charge": {"type": charge_type}, **kw}


def run_refund(monkeypatch, doc, user_doc):
    users = FakeCollection([user_doc])
    jobs = FakeCollection([doc])
    monkeypatch.setattr(refund, "db", FakeDb(users=users))
    refund.refund_charge(jobs, doc)
    return users, jobs


def test_free_charge_refunds_one_slot(monkeypatch):
    user = {"id": "u1", "freeNestingUsed": 3}
    users, jobs = run_refund(monkeypatch, job("free"), user)
    assert user["freeNestingUsed"] == 2
    assert jobs.docs[0]["charge"]["refunded"] is True


def test_demo_charge_refunds_one_demo_slot(monkeypatch):
    user = {"id": "u1", "demoNestingUsed": 4}
    users, jobs = run_refund(monkeypatch, job("demo"), user)
    assert user["demoNestingUsed"] == 3
    assert jobs.docs[0]["charge"]["refunded"] is True


def test_grant_and_subscription_charges_refund_nothing(monkeypatch):
    for t in ("grant", "subscription"):
        user = {"id": "u1", "freeNestingUsed": 3, "demoNestingUsed": 2}
        users, jobs = run_refund(monkeypatch, job(t), user)
        assert user["freeNestingUsed"] == 3
        assert user["demoNestingUsed"] == 2
        # ...but the job is still marked refunded (idempotence).
        assert jobs.docs[0]["charge"]["refunded"] is True


def test_already_refunded_is_a_noop(monkeypatch):
    user = {"id": "u1", "freeNestingUsed": 3}
    doc = job("free")
    doc["charge"]["refunded"] = True
    users, jobs = run_refund(monkeypatch, doc, user)
    assert user["freeNestingUsed"] == 3
    assert users.calls == []


def test_missing_charge_is_a_noop(monkeypatch):
    user = {"id": "u1", "freeNestingUsed": 3}
    doc = {"_id": "j1", "ownerId": "u1"}
    users, jobs = run_refund(monkeypatch, doc, user)
    assert user["freeNestingUsed"] == 3


def test_refund_guard_never_goes_negative(monkeypatch):
    # freeNestingUsed already 0: the $gt: 0 filter must not match — the
    # counter stays at 0 (no phantom credit).
    user = {"id": "u1", "freeNestingUsed": 0}
    users, jobs = run_refund(monkeypatch, job("free"), user)
    assert user["freeNestingUsed"] == 0
    assert jobs.docs[0]["charge"]["refunded"] is True
