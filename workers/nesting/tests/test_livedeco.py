"""AA5 (vérif L1 2026-09-05) — arrêt sûr du décorateur de frames live.

Régression du lot 1 : `put_nowait(None)` sur une file pleine perdait le
sentinel → join(5) inutile pendant que le thread décorait encore la frame
en attente (écriture liveLayout possible après finalisation) puis restait
bloqué sur get() — fuite d'un thread par job. Le drapeau d'abord garantit :
file pleine à l'arrêt → thread terminé vite, la frame en attente
ABANDONNÉE (jamais décorée après stop).
"""
import threading
import time

from core.livedeco import LiveDecorator


def test_stop_with_full_queue_terminates_fast_and_drops_pending():
    """File PLEINE à l'arrêt : thread mort < 1 s, frame en attente jamais
    décorée (aucune « écriture » après finalisation)."""
    calls = []
    in_first = threading.Event()

    def slow_decorate(event):
        calls.append(event)
        if event == "first":
            in_first.set()
            time.sleep(0.3)  # frame en cours au moment du stop

    d = LiveDecorator(slow_decorate)
    d.start()
    d.submit("first")
    assert in_first.wait(timeout=2), "la première frame n'a pas été prise"
    # File PLEINE : une frame en attente pendant que la première se décore.
    d.submit("pending")
    d.submit("pending2")  # coalescing : remplace pending

    t0 = time.monotonic()
    d.stop(timeout=5.0)
    elapsed = time.monotonic() - t0

    assert elapsed < 1.0, f"arrêt trop lent : {elapsed:.2f}s (join inutile ?)"
    assert d._thread is None
    # La frame EN COURS est terminée, la frame EN ATTENTE est abandonnée :
    # jamais de décoration post-arrêt.
    assert calls == ["first"], f"frame décorée après stop : {calls}"

    # Le thread est réellement mort (pas seulement join timeout) : submit
    # après stop ne décore rien non plus.
    d.submit("after-stop")
    time.sleep(0.2)
    assert calls == ["first"]


def test_coalescing_keeps_only_latest():
    """Drop-stale : parmi les frames EN ATTENTE, seule la dernière est
    décorée — la frame en cours se termine, l'intermédiaire est écrasée.
    (L'arrêt, lui, abandonne toute frame pas encore en décoration :
    testée séparément ci-dessus.)"""
    calls = []
    first_taken = threading.Event()
    release = threading.Event()

    def decorate(event):
        first_taken.set()
        release.wait(timeout=2)
        calls.append(event)

    d = LiveDecorator(decorate)
    d.start()
    d.submit("a")
    assert first_taken.wait(timeout=2), "la première frame n'est pas en décoration"
    d.submit("b")  # en attente
    d.submit("c")  # écrase b
    release.set()

    deadline = time.monotonic() + 2
    while time.monotonic() < deadline and "c" not in calls:
        time.sleep(0.01)
    assert calls == ["a", "c"], f"coalescing cassé : {calls} (b décorée ou c perdue)"

    d.stop(timeout=5.0)
    time.sleep(0.1)
    assert calls == ["a", "c"], f"décoration après stop : {calls}"


def test_submit_after_stop_is_noop():
    calls = []
    d = LiveDecorator(calls.append)
    d.start()
    d.stop(timeout=5.0)
    d.submit("x")
    time.sleep(0.15)
    assert calls == []
