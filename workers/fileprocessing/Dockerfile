# Build context is ./workers (repo CI sets it) so the shared worker_common
# package can be installed into the image.

# ---------------------------------------------------------------------------
# Stage 1: build GNU LibreDWG (GPL v3) — provides dwgread (DWG -> DXF import)
# and dwgwrite (test fixtures). Pinned version + sha256; the source tree is
# shipped in the final image at /opt/libredwg-src (GPL source offer).
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS libredwg
ARG LIBREDWG_VERSION=0.13.3
ARG LIBREDWG_SHA256=83f1f6e78a744777a481ff4520e4cef3f8ac4b2c1c25671077ca12fe81e8816e
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl xz-utils build-essential libpcre2-dev \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL "https://ftp.gnu.org/gnu/libredwg/libredwg-${LIBREDWG_VERSION}.tar.xz" -o /tmp/libredwg.tar.xz \
    && echo "${LIBREDWG_SHA256}  /tmp/libredwg.tar.xz" | sha256sum -c - \
    && mkdir -p /opt && tar -xJf /tmp/libredwg.tar.xz -C /opt
# LibreDWG 0.13.3 trips gcc>=12's -Werror=alloc-size (known false positives
# in in_dxf.c) — -Wno-error keeps them as warnings, build succeeds.
RUN cd /opt/libredwg-${LIBREDWG_VERSION} \
    && ./configure --prefix=/usr/local --disable-bindings --disable-python CFLAGS="-g -O2 -Wno-error" \
    && make -j"$(nproc)" -C src \
    && make -j"$(nproc)" -C programs \
    && make -C src install \
    && make -C programs install

# ---------------------------------------------------------------------------
# Final image
# ---------------------------------------------------------------------------
FROM python:3.11-slim

# Runtime dep of dwgread (PCRE2).
RUN apt-get update && apt-get install -y --no-install-recommends libpcre2-8-0 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=libredwg /usr/local/bin/dwgread /usr/local/bin/dwgread
COPY --from=libredwg /usr/local/bin/dwgwrite /usr/local/bin/dwgwrite
# libredwg.so lives in the build tree's .libs (libtool): dwgread links
# against it dynamically — LibreDWG's configure ignores --disable-shared.
COPY --from=libredwg /opt/libredwg-0.13.3/src/.libs/libredwg.so* /usr/local/lib/
RUN ldconfig
# GPL source offer: the exact sources the binaries were built from.
COPY --from=libredwg /opt/libredwg-0.13.3 /opt/libredwg-src

WORKDIR /app

RUN pip install --upgrade pip

# Shared worker plumbing (mongo connection, crypto, logging, worker loop).
COPY common /opt/common
RUN pip install --no-cache-dir /opt/common

COPY fileprocessing/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY fileprocessing/ .

# Non-root: dwgread (LibreDWG C parser) must not run as root if a crafted
# DWG ever hits a parser bug (pentest C-2). Binaries in /usr/local stay
# world-executable; the worker only needs write access to /app and /tmp.
RUN groupadd --system appuser && useradd --system --gid appuser --home-dir /app --no-create-home appuser \
    && chown -R appuser:appuser /app
USER appuser

CMD ["python", "main.py"]
