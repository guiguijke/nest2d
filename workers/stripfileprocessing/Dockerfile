# Build context is ./workers (repo CI sets it) so the shared worker_common
# package can be installed into the image.
FROM python:3.11-slim

WORKDIR /app

# Shared worker plumbing (mongo connection, crypto, logging, worker loop).
COPY common /opt/common
RUN pip install --no-cache-dir /opt/common

COPY stripfileprocessing/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY stripfileprocessing/ .

RUN groupadd --system appuser && useradd --system --gid appuser --home-dir /app --no-create-home appuser \
    && chown -R appuser:appuser /app
USER appuser

CMD ["python", "main.py"]
