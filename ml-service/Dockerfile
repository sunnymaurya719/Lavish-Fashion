# syntax=docker/dockerfile:1.6
# Multi-stage build for the ML service (I3).
# Stage 1 builds wheels for every dependency in an isolated builder image so the
# final runtime stage stays slim and never carries pip, build toolchains, or
# wheel caches into production.

ARG PYTHON_BASE_IMAGE=python:3.12-slim
ARG REQUIREMENTS_FILE=requirements.local.txt

# ---------- builder ----------
FROM ${PYTHON_BASE_IMAGE} AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements.local.txt ./
ARG REQUIREMENTS_FILE
RUN pip wheel --no-cache-dir --wheel-dir=/wheels -r ${REQUIREMENTS_FILE}

# ---------- runtime ----------
FROM ${PYTHON_BASE_IMAGE} AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONHASHSEED=0

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1000 mlservice \
    && useradd  --system --uid 1000 --gid mlservice --home /app --no-create-home mlservice

COPY --from=builder /wheels /wheels
COPY requirements.txt requirements.local.txt ./
ARG REQUIREMENTS_FILE
RUN pip install --no-cache-dir --no-index --find-links=/wheels -r ${REQUIREMENTS_FILE} \
    && rm -rf /wheels

COPY app ./app
COPY index.py ./

RUN chown -R mlservice:mlservice /app

USER mlservice

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

ARG REQUIREMENTS_FILE=requirements.local.txt

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1000 mlservice \
    && useradd  --system --uid 1000 --gid mlservice --home /app --no-create-home mlservice

COPY requirements.txt requirements.local.txt ./
RUN pip install --no-cache-dir -r ${REQUIREMENTS_FILE}

COPY app ./app
COPY index.py ./

RUN chown -R mlservice:mlservice /app

USER mlservice

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
