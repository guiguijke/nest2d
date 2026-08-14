"""Driver for the nest-engine Rust binary.

Replaces the old lbf racing tournament (core/racing.py): ONE engine call per
job. The engine does its own parallel multi-start internally (rayon), keeps
its incumbent, and writes sol_instance.json + alternatives.json.

Protocol: file-based CLI (lbf conventions) —
    nest-engine -i instance.json -c config.json -s out_dir -p spp|bpp
stdout carries JSON event lines (start / progress / heartbeat / done / error)
which are forwarded to the caller for live UI progress.
"""
import json
import os
import subprocess
import tempfile
import threading

from worker_common.logger import setup_logger

logger = setup_logger("nesting_engine")

ENGINE_BIN = os.environ.get("NEST_ENGINE_BIN", "nest-engine")
# Safety margin on top of the engine's own time budget: the engine stops on
# its own, this only guards against a hang.
TIMEOUT_GRACE_SECONDS = int(os.environ.get("NEST_ENGINE_TIMEOUT_GRACE", "120"))


class EngineError(Exception):
    pass


class EngineCancelled(Exception):
    """Raised when the owning job was cancelled by the user mid-run."""
    pass


def _normalize_solution(problem_type, solution):
    """Normalizes an engine solution to the shape the rest of the pipeline
    consumes: {"layouts": [...], "density": ..., "cost": ...}.

    SPP solutions carry a single `layout` (the strip); BPP solutions already
    have `layouts`. The SPP strip is the single sheet (container_id 0).
    """
    if problem_type == "spp":
        layout = solution.get("layout") or {}
        # The strip's internal container id (a jagua internals artifact) is
        # meaningless downstream — the SPP strip is always THE single sheet.
        layout["container_id"] = 0
        return {
            "layouts": [layout],
            "density": solution.get("density"),
            # one strip = one sheet used
            "cost": 1,
            "strip_width": solution.get("strip_width"),
        }
    return {
        "layouts": solution.get("layouts", []),
        "density": solution.get("density"),
        "cost": solution.get("cost"),
    }


def run_engine(instance, config, problem_type, on_event=None, should_cancel=None, rayon_threads=None):
    """Runs the engine and returns a list of normalized alternatives:
    [{"rank", "seed", "solution": {...normalized...}, "metrics": {...}}],
    best first. Raises EngineError when nothing feasible was produced.

    on_event(event_dict) is invoked for every engine event line (may be None).
    should_cancel() is polled about every second while the engine runs; when
    it returns True the engine process is killed and EngineCancelled raised.
    """
    time_budget = int(config.get("time_budget_sec", 60))
    timeout = time_budget + TIMEOUT_GRACE_SECONDS

    with tempfile.TemporaryDirectory(prefix="nest_engine_") as tmpdir:
        instance_path = os.path.join(tmpdir, "instance.json")
        config_path = os.path.join(tmpdir, "config.json")
        out_dir = os.path.join(tmpdir, "out")

        with open(instance_path, "w") as f:
            json.dump(instance, f)
        with open(config_path, "w") as f:
            json.dump(config, f)

        env = os.environ.copy()
        # D-PAY-12 : n_workers = taille de la recherche (8 walks) ;
        # RAYON_NUM_THREADS = concurrence du tier (1 / 4 / 8). Sans ça
        # Unlimited lancerait 8 walks en parallèle comme Pro.
        if rayon_threads:
            env["RAYON_NUM_THREADS"] = str(int(rayon_threads))
        proc = subprocess.Popen(
            [ENGINE_BIN, "-i", instance_path, "-s", out_dir,
             "-c", config_path, "-p", problem_type],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )

        stderr_lines = []

        def _read_stderr():
            for line in proc.stderr:
                stderr_lines.append(line)

        stderr_thread = threading.Thread(target=_read_stderr, daemon=True)
        stderr_thread.start()

        done_event = {}
        error_event = {}

        def _read_stdout():
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    logger.warning("engine: non-JSON stdout line", extra={"line": line[:200]})
                    continue
                etype = event.get("type")
                if etype == "done":
                    done_event.update(event)
                elif etype == "error":
                    error_event.update(event)
                if on_event is not None:
                    try:
                        on_event(event)
                    except Exception:
                        pass

        stdout_thread = threading.Thread(target=_read_stdout, daemon=True)
        stdout_thread.start()

        # Poll in small slices so user cancellation is responsive (~1s).
        import time as _time
        deadline = _time.monotonic() + timeout
        cancelled = False
        while True:
            if should_cancel is not None and should_cancel():
                cancelled = True
                proc.kill()
                break
            try:
                returncode = proc.wait(timeout=1.0)
                break
            except subprocess.TimeoutExpired:
                if _time.monotonic() > deadline:
                    proc.kill()
                    proc.wait()
                    raise EngineError(f"engine timed out after {timeout}s")
        stdout_thread.join(timeout=5)
        stderr_thread.join(timeout=5)

        if cancelled:
            proc.wait()
            raise EngineCancelled("job cancelled by user")

        if returncode != 0:
            stderr_tail = "".join(stderr_lines).strip()[-400:]
            logger.error(
                "engine failed",
                extra={"returncode": returncode, "stderr": stderr_tail},
            )
            reason = error_event.get("reason", "unknown")
            raise EngineError(f"engine failed (rc={returncode}, reason={reason}): {stderr_tail}")

        alternatives_path = os.path.join(out_dir, "alternatives.json")
        if not os.path.exists(alternatives_path):
            raise EngineError("engine produced no alternatives.json")
        with open(alternatives_path) as f:
            raw_alternatives = json.load(f)

    alternatives = []
    for alt in raw_alternatives:
        solution = alt.get("solution") or {}
        alternatives.append({
            "rank": alt.get("rank"),
            "seed": alt.get("seed"),
            # Directional class of this alternative (left/bottom/balanced),
            # None on engines/jobs without directions.
            "bias": alt.get("bias"),
            "iterations": alt.get("iterations"),
            "evaluations": alt.get("evaluations"),
            "solution": _normalize_solution(problem_type, solution),
            "metrics": {
                "density": alt.get("density") or solution.get("density"),
                "cost": alt.get("cost"),
                "strip_width": alt.get("strip_width") or solution.get("strip_width"),
                "layout_count": alt.get("layout_count"),
            },
        })

    if not alternatives:
        raise EngineError("engine produced no feasible solution")

    logger.info(
        "engine finished",
        extra={
            "problem_type": problem_type,
            "alternatives": len(alternatives),
            "elapsed": done_event.get("elapsed_sec"),
        },
    )
    return alternatives
