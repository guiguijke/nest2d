from worker_common.mongo import db
from worker_common.refund import refund_charge
from worker_common.worker_loop import WorkerConfig, run_worker

from core.main import strip_nesting_process

strip_nesting_jobs = db["strip_nesting_job_queue"]

run_worker(
    WorkerConfig(
        name="main_stripnesting",
        collection="strip_nesting_job_queue",
        process=strip_nesting_process,
        status_field="status",
        done_status="done",
        error_field="error",
        track_timing=True,
        refund=lambda doc: refund_charge(strip_nesting_jobs, doc),
    )
)
