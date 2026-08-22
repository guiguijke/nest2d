# Build context is ./workers (repo CI sets it) so the shared worker_common
# package can be installed into the image.
FROM python:3.11-slim

WORKDIR /app

# spyrrow ships manylinux x86_64 wheels (it wraps the sparrow Rust solver), so
# there is no Rust toolchain / cargo build step here — a plain pip install is
# enough, unlike the jagua-rs based bin nesting worker.
# Shared worker plumbing (mongo connection, crypto, logging, worker loop).
COPY common /opt/common
RUN pip install --no-cache-dir /opt/common

COPY stripnesting/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY stripnesting/ .

RUN groupadd --system appuser && useradd --system --gid appuser --home-dir /app --no-create-home appuser \
    && chown -R appuser:appuser /app
USER appuser

CMD ["python", "main.py"]
