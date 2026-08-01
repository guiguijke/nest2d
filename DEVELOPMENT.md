## The development instruction

### Prerequisites
- Machine with docker

Note: ** The local development tested only on mac os with Intel arch with [colima](https://github.com/abiosoft/colima) as docker engine. **
To install colima use brew 

```sh
brew install colima
```

### Mongo setup

```sh
mkdir .mongo-data
docker run -d --name nest2d_mongo -p 27017:27017 --user "$(id -u):$(id -g)" -v "$(pwd)/.mongo-data":/data/db mongo
```

To restore the mongo from backup run the command
```sh
mongorestore --uri="mongodb://localhost:27017" --gzip --archive=mongo_backup_latest.gz --nsInclude="nest2d-v2.*"
```

To stop the container runs

```sh
docker stop nest2d_mongo
```

To clean data 
```sh
rm -rf .mongo-data
```

The Mongo is the only one storage need for run project localy, all files (dxf, svg, and user avatars) saved by Mongo GridFS. 
It's implement in purpuse to make the developer life easier.

### Run the workers

```sh
docker compose up
```

This brings up the full stack from `docker-compose.yml`: the app, the admin
panel, MongoDB and all four workers (file processing, nesting, and their
"strip" variants). Each worker runs with replication equal to **one**.

To run only the workers (e.g. while developing the app locally), target the
worker services explicitly:

```sh
docker compose up user-file-processing-worker nesting-worker strip-file-processing-worker strip-nesting-worker
```