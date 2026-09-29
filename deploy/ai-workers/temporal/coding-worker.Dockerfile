FROM python:3.12-slim

RUN pip install --no-cache-dir temporalio==1.33.0

WORKDIR /app
COPY temporal/coding-worker.py /app/coding-worker.py

CMD ["python", "/app/coding-worker.py"]
