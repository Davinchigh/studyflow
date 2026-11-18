FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
RUN addgroup --system studyflow && adduser --system --ingroup studyflow studyflow \
    && mkdir -p /data && chown studyflow:studyflow /data
# Each tester's workspace is a SQLite file in /data: mount a persistent volume or disk here.
ENV STUDY_DATA_DIR=/data \
    STUDY_DB_PATH=/data/study_planner.db
USER studyflow
EXPOSE 8000
# Hosts that assign a port pass it in $PORT. --proxy-headers keeps the real client IP for rate limiting.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
