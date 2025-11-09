FROM python:3.11-slim

WORKDIR /app

RUN pip install --upgrade pip

RUN apt-get update && apt-get install -y libgeos-dev

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install shapely --no-binary :all:
COPY . .

CMD ["python", "main.py"]
