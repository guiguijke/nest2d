# DWG import — licence notes (GNU LibreDWG, GPL v3)

DWG is a closed binary format. The file-processing worker converts DWG
uploads to DXF with **`dwgread` from GNU LibreDWG** (GPL v3), built from the
official GNU tarball at image build time (pinned version + sha256, see
`workers/fileprocessing/Dockerfile`).

## Why this is compatible with the business model

- **SaaS (app.nestorcut.com)** — LibreDWG runs on our servers only. No
  distribution takes place, so the GPL imposes nothing beyond keeping its
  copyright notices. Our code stays proprietary.
- **Self-hosted / appliance sales** — `dwgread` is invoked as a plain
  **subprocess** (shell-out, no linking, no shared address space). This is
  "mere aggregation" in GPL terms: our proprietary code is not a derivative
  work of LibreDWG, and is not contaminated.
- **Source offer** — the exact LibreDWG source tree the binaries were built
  from is shipped inside the image at `/opt/libredwg-src`, satisfying the
  GPL v3 source-availability requirement for the binaries we distribute in
  the image itself.
- **What we must NOT do** — link against `libredwg` (C library) from our
  code, or modify the `dwgread` binary. Both would create a derivative work
  and require GPL-licensing the corresponding parts of our product. The
  current integration (unmodified binary, subprocess call) stays clear of
  this.

## Why not ODA File Converter

The Open Design Alliance converter is the industry-standard DWG reader, but
it is proprietary freeware: embedding its binary in a distributed product
requires a (paid) ODA agreement. It was ruled out for this product.

## Conversion failures

LibreDWG reads DWG reliably up to R2007; R2013+ support is experimental.
Unreadable files are rejected with a clear user message ("export as DXF
R2000 or later") — never silently dropped, never partially imported.
