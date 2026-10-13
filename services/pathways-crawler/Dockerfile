FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN groupadd --gid 10001 crawler && useradd --uid 10001 --gid crawler --create-home crawler
WORKDIR /app
COPY . /app
RUN pip install --no-cache-dir pypdf==5.9.0 && mkdir -p /data && chown -R crawler:crawler /data /app
USER crawler
ENTRYPOINT ["/bin/sh", "/app/entrypoint.sh"]
