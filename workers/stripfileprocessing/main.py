from worker_common.worker_loop import WorkerConfig, run_worker

from core.main import process_file

run_worker(
    WorkerConfig(
        name="main_stripfileprocessing",
        collection="strip_user_dxf_files",
        process=process_file,
        status_field="processingStatus",
        done_status="completed",
        error_field="processingError",
        result_based_completion=True,
    )
)
