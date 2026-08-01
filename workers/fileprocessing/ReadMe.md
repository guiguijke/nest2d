## The nest2d file preprocessing worker 

The application use dxf handle value as unique identificator for mathing the parts, lines, polygones etc. Time to time some dxf doen't provide the handle as unique field.
The worker rebuild the dxf file, and create a valid JSON presentation for the dxf file, with list of close polygones and coresponding handle new the new file.

## Build docker image

The build context is `./workers` (not this folder) so the shared `worker_common`
package (`workers/common`) can be installed into the image. From the repo root:

```sh
docker build -f workers/fileprocessing/Dockerfile -t nest2d-worker-fileprocessing:local workers/
````

Run as service

```sh
docker service create \
  --name my-file-processing-service \
  --env-file ./.env \
  nest2d-worker-fileprocessing:local
```

## Local development run 

Install the shared package and the worker dependencies first:

```sh
pip install -e ../common
pip install -r requirements.txt
python main.py
```

Or with Docker:

```sh
docker run --network host -it -v "$(pwd):/app" -w /app nest2d-worker-fileprocessing:local bash
```