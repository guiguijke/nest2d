"""AA5 (vérif L1 2026-09-05) : décorateur de frames live — thread dédié à
file coalescente, arrêt SÛR.

Le lot 1 portait la décoration des frames live sur un thread dédié (P2),
mais l'arrêt pouvait fuiter : `put_nowait(None)` sur une file pleine
abandonnait le sentinel, `join(5)` attendait pour rien pendant que le
thread décorait encore une frame en attente — écriture `liveLayout`
possible sur un job déjà finalisé, puis blocage sur `get()` (fuite d'un
thread par job).

Sémantique d'arrêt ici : le DRAPEAU prime. Même file pleine (frame en
attente), le consommateur la vide de son `get()` et voit le drapeau →
sortie immédiate SANS la décorer. Le sentinel ne sert qu'à réveiller un
`get()` bloquant sur file vide. La frame EN COURS de décoration au moment
de l'arrêt est terminée (jamais interrompue au milieu), puis le thread
sort : `stop()` ne rend la main qu'une fois le thread mort.
"""
import queue
import threading


class LiveDecorator:
    """Consomme la DERNIÈRE frame déposée (coalescing drop-stale) et la
    passe à `decorate(event)` — jamais plus d'une frame en attente."""

    def __init__(self, decorate):
        self._decorate = decorate
        self._q = queue.Queue(maxsize=1)
        self._stop = threading.Event()
        self._thread = None

    def _loop(self):
        while not self._stop.is_set():
            event = self._q.get()
            if event is None or self._stop.is_set():
                return
            try:
                self._decorate(event)
            except Exception:
                # Le décorateur propre (report_live_layout) attrape déjà
                # ses erreurs — ce filet ne masque que l'inattendu.
                pass

    def start(self):
        if self._thread is not None:
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._loop, daemon=True, name="live-decorator"
        )
        self._thread.start()

    def submit(self, event):
        """Dépose une frame en écrasant toute frame en attente (drop-stale)."""
        if self._stop.is_set():
            return
        try:
            self._q.put_nowait(event)
        except queue.Full:
            try:
                self._q.get_nowait()
            except queue.Empty:
                pass
            try:
                self._q.put_nowait(event)
            except queue.Full:
                pass

    def stop(self, timeout=5.0):
        """Drapeau d'abord, sentinel pour réveiller, join. Idempotent."""
        if self._thread is None:
            return
        self._stop.set()
        try:
            self._q.put_nowait(None)
        except queue.Full:
            pass
        self._thread.join(timeout=timeout)
        self._thread = None
