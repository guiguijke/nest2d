import os

from worker_common.logger import setup_logger
from worker_common.worker_loop import WorkerConfig, run_worker

from core.main import process_file

worker_tag = os.environ.get("WORKER_TAG", "normal")

setup_logger("main_fileprocessing").info(
    "Worker file processing started with tag", extra={"tag": worker_tag}
)

run_worker(
    WorkerConfig(
        name="main_fileprocessing",
        collection="user_dxf_files",
        process=process_file,
        status_field="processingStatus",
        done_status="completed",
        error_field="processingError",
        query_extra={"worker_tag": worker_tag},
        result_based_completion=True,
    )
)
