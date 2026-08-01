# worker_common — shared plumbing for the Nest2D Python workers

All 4 workers (fileprocessing, nesting, stripfileprocessing, stripnesting) share
this package instead of carrying their own copy of the same code.

Contents:

| Module | Purpose |
|---|---|
| `worker_common/crypto.py` | Zero-knowledge vault crypto (AES-256-GCM frames). **Mirrors `server/utils/crypto.js` exactly** — any change must be mirrored there and re-validated with `scripts/crypto-interop/`. |
| `worker_common/logger.py` | JSON logging (`setup_logger`). |
| `worker_common/mongo.py` | Mongo connection (`db`) from `MONGO_URI` + lazy GridFS buckets via `get_bucket(name)`. |
| `worker_common/worker_loop.py` | Generic polling loop (`run_worker(WorkerConfig)`): atomic claim, heartbeat, SIGTERM graceful shutdown, status transitions, optional timing/refund/cancellation hooks. |
| `worker_common/refund.py` | `refund_charge` — gives back a free nesting slot when a job fails. |
| `worker_common/geometry/dxf_parser.py` | DXF entity → shapely conversion (`flatten_entity`, `convert_entity_to_shapely`). Requires shapely (pinned by the workers that use it, not by this package). |

## Install

```sh
# from the repo root, for local development
pip install -e workers/common
```

In Docker, each worker image builds with `./workers` as context and installs the
package from `COPY common /opt/common && pip install /opt/common`.
