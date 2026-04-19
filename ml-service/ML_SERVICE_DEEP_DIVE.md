# Lavish Fit ML Service — Deep Dive & Advanced Optimization Blueprint

> Scope: a top-to-bottom audit of everything that lives under [ml-service/](ml-service) today, plus a battle-tested optimization roadmap to take the service from "works in dev" to "advanced, reliable, production-grade".
>
> Audience: backend engineers, ML engineers, SREs and tech leads working on the Lavish Fit AI assistant.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Repository Layout](#2-repository-layout)
3. [Runtime Architecture](#3-runtime-architecture)
4. [Configuration & Secrets](#4-configuration--secrets)
5. [HTTP API Surface](#5-http-api-surface)
6. [Domain Model & Schemas](#6-domain-model--schemas)
7. [Recommendation Pipeline (deep)](#7-recommendation-pipeline-deep)
8. [Body Analysis Pipeline (deep)](#8-body-analysis-pipeline-deep)
9. [Feature Engineering](#9-feature-engineering)
10. [Heuristic Fit Scoring](#10-heuristic-fit-scoring)
11. [Model Service & Artifact Loading](#11-model-service--artifact-loading)
12. [Training Stack](#12-training-stack)
13. [Image Utilities](#13-image-utilities)
14. [Tests](#14-tests)
15. [Build, Packaging & Deployment](#15-build-packaging--deployment)
16. [Known Gaps, Risks & Smells](#16-known-gaps-risks--smells)
17. [Advanced Optimization Plan](#17-advanced-optimization-plan)
    - [17.1 Reliability & Resilience](#171-reliability--resilience)
    - [17.2 Performance & Throughput](#172-performance--throughput)
    - [17.3 Security & Hardening](#173-security--hardening)
    - [17.4 Observability](#174-observability)
    - [17.5 ML Quality & MLOps](#175-ml-quality--mlops)
    - [17.6 Data Pipeline](#176-data-pipeline)
    - [17.7 Body Analysis Roadmap](#177-body-analysis-roadmap)
    - [17.8 API & Contract Evolution](#178-api--contract-evolution)
    - [17.9 Testing Strategy](#179-testing-strategy)
    - [17.10 Deployment & Infrastructure](#1710-deployment--infrastructure)
    - [17.11 Cost & FinOps](#1711-cost--finops)
    - [17.12 Governance, Privacy & Compliance](#1712-governance-privacy--compliance)
18. [Phased Execution Roadmap](#18-phased-execution-roadmap)
19. [Acceptance Criteria & SLOs](#19-acceptance-criteria--slos)
20. [Appendix — Feature Vector Reference](#20-appendix--feature-vector-reference)

---

## 1. Executive Summary

The `ml-service` is a small but well-structured **FastAPI** microservice that backs the Lavish Fit "AI fit assistant". It owns two responsibilities:

- **`POST /recommend-size`** — given a product's size chart and a user's body metrics, returns the best size, alternatives, a confidence score and a human-readable reason. Internally it blends a deterministic heuristic with an XGBoost regressor that scores `(user × size)` candidates.
- **`POST /analyze-body`** — given pose landmarks (preferred) or a base64 selfie (heuristic fallback), returns normalized body ratios (`shoulderRatio`, `hipRatio`, `torsoRatio`) and a `scanQuality` signal that the recommender can blend in.

The codebase is **clean, typed and modular**, with a meaningful split between schemas, services, model artifact, training and tests. Cold-start training is bootstrapped from a synthetic generator and can be blended with the public **Rent the Runway** review dataset.

What it is **not** yet: production-grade. There is no rate limiting, no structured logging, no metrics, no model registry, no batching, no caching, no graceful reload, no canary, and the body-analysis path is a placeholder for the real pose pipeline. Section 17 lays out exactly how to fix that.

---

## 2. Repository Layout

```
ml-service/
├── Dockerfile                        # python:3.12-slim + uvicorn entrypoint
├── index.py                          # Vercel/serverless re-export of `app`
├── requirements.txt                  # Runtime deps for serverless (no numpy/xgboost)
├── requirements.local.txt            # Full dev/training deps (adds numpy, uvicorn[standard], xgboost)
├── .env.example                      # ML_APP_ENV, MODEL_VERSION, MODEL_PATH, ML_SERVICE_SHARED_SECRET
├── app/
│   ├── main.py                       # FastAPI app + lifespan -> model_service.load_model()
│   ├── api/routes.py                 # /health, /recommend-size, /analyze-body + shared-secret guard
│   ├── core/config.py                # Frozen dataclass Settings sourced from env
│   ├── schemas/
│   │   ├── request_models.py         # RecommendationRequest, AnalyzeBodyRequest, etc.
│   │   └── response_models.py        # RecommendationResponse, AnalyzeBodyResponse, HealthResponse
│   ├── services/
│   │   ├── feature_builder.py        # Body-profile estimation + 20-dim feature vector builder
│   │   ├── fit_scoring.py            # Heuristic per-size penalty + breakdown
│   │   ├── recommendation_service.py # Orchestrates heuristic + XGBoost, builds final response
│   │   ├── body_analysis.py          # Landmark + image heuristic body analysis
│   │   ├── model_service.py          # Joblib loading, predict_fit_scores wrapper
│   │   └── model_artifact.py         # GradientBoostedFitArtifact (xgboost DMatrix predict)
│   ├── utils/image_utils.py          # base64 data-URL parsing + JPEG/PNG header dimension reader
│   └── models/
│       ├── size_recommender.joblib              # Trained artifact (xgb-fit-v1)
│       └── size_recommender.metadata.json       # Training metadata snapshot
├── train/
│   ├── build_dataset.py              # Synthetic candidate generator (cold-start)
│   ├── external_review_dataset.py    # Rent the Runway loader → pseudo size charts
│   ├── train_model.py                # CLI: build corpus + train XGBoost + persist artifact
│   └── data/fit_feedback_preview.jsonl
└── tests/
    ├── test_recommendation.py
    ├── test_body_analysis.py
    ├── test_train_model.py
    └── test_external_review_dataset.py
```

The two requirements files are deliberate: Vercel's Python runtime is size-constrained, so heavy deps (`numpy`, `xgboost`) are only needed for **training and local serving with the model loaded**.

---

## 3. Runtime Architecture

```text
                ┌─────────────────────┐
HTTP request -> │  FastAPI router     │ -> verify_shared_secret (header)
                └─────────┬───────────┘
                          │
            ┌─────────────┴────────────────┐
            │                              │
    /recommend-size                  /analyze-body
            │                              │
            ▼                              ▼
RecommendationService             analyze_body_request
  ├── estimate_body_profile        ├── landmarks branch (preferred)
  ├── evaluate_candidate_size *N   └── image_heuristic branch (fallback)
  ├── build_candidate_feature_map
  └── ModelService.predict_fit_scores  ──► joblib artifact
                                            └── GradientBoostedFitArtifact
                                                  └── xgboost.Booster.predict
```

**Lifespan:** `app/main.py` registers an async `lifespan` context that calls `model_service.load_model()` once at startup. There is **no shutdown hook** and **no model-reload endpoint**.

**Concurrency model:** classic uvicorn workers. The recommender path is fully synchronous CPU work (the XGBoost predict call releases the GIL), so throughput scales with `--workers`. The body-analysis path is also synchronous and pure-Python.

---

## 4. Configuration & Secrets

Everything routes through [app/core/config.py](app/core/config.py):

| Env var | Default | Purpose |
| --- | --- | --- |
| `ML_APP_NAME` | `Lavish Fit ML Service` | App title (FastAPI + health) |
| `ML_APP_ENV` | `development` | Reported in `/health` |
| `MODEL_VERSION` | `xgb-fit-v1` | Fallback version when the artifact has no metadata |
| `MODEL_PATH` | `app/models/size_recommender.joblib` | Resolved with `Path(...).resolve()` |
| `ML_SERVICE_SHARED_SECRET` | `""` | If empty, the secret check is **disabled** |

Notes:

- `Settings` is a **frozen dataclass**, so it is read once at import time. There is no support for hot-reloading config without restarting the process.
- `_normalize_secret` only strips whitespace; it does not enforce a minimum length.
- The Node server passes the same secret via the `x-ml-service-secret` header (see `verify_shared_secret`).

---

## 5. HTTP API Surface

Defined in [app/api/routes.py](app/api/routes.py).

### `GET /health`
Public. Returns `status`, `appName`, `environment`, `modelLoaded`, `modelVersion`. Used by the Node backend's healthcheck and by Vercel/Render/k8s probes.

### `POST /recommend-size` (guarded)
- Body: `RecommendationRequest`
- Success: `200 RecommendationResponse`
- Failure modes:
  - `401` — missing/wrong `x-ml-service-secret`
  - `422` — Pydantic validation failure **or** any `ValueError` raised by the recommender (e.g. "no size measurements", "fit profile not ready")

### `POST /analyze-body` (guarded)
- Body: `AnalyzeBodyRequest` (must contain `landmarks` or `imageBase64`)
- Success: `200 AnalyzeBodyResponse`
- Failure modes:
  - `401` — bad secret
  - `422` — invalid base64 / unsupported image format / incomplete landmarks
  - `501` — when neither landmarks nor image are usable (placeholder for the camera phase)

There is **no** `/metrics`, `/ready`, `/version`, `/reload-model`, or `/feedback` endpoint yet.

---

## 6. Domain Model & Schemas

All Pydantic v2. Highlights from [app/schemas/request_models.py](app/schemas/request_models.py):

- `MeasurementTemplate` ∈ `{topwear, bottomwear, dress, outerwear, kids_general}` — drives which fields are required.
- `FitBias` ∈ `{runs_small, true_to_size, runs_large}` — product-level prior, applied as a constant offset on non-length measurements.
- `PreferredFit` ∈ `{slim, regular, relaxed}` — user preference, drives ease tables.
- `SizeMeasurement` carries optional `chest`, `waist`, `hip`, `shoulder`, `sleeveLength`, `inseam`, `garmentLength` in cm.
- `ProductFitProfileSummary.ready=False` short-circuits the request with a clear 422.
- `BodyFeaturesInput` carries optional ratios + `scanQuality`. All bounded 0..1 where it matters.
- `AnalyzeBodyRequest.validate_scan_input` enforces "either landmarks or image".

Responses ([app/schemas/response_models.py](app/schemas/response_models.py)) are explicit and stable: `source` ∈ `{ml, heuristic}`, `recommendation` (size/confidence/reason/range), `alternatives[]`, `insights`, `meta` (model version, fit template, prediction source, model loaded flag).

---

## 7. Recommendation Pipeline (deep)

Implemented in [app/services/recommendation_service.py](app/services/recommendation_service.py).

1. **Guard** — if `fitProfileSummary.ready` is explicitly `False`, raise `"This product does not have enough fit data for recommendations yet."` Otherwise validate that at least one `sizeMeasurements` row exists.
2. **Body profile estimation** — `estimate_body_profile(...)` produces `{chest, waist, hip, shoulder, bmi}` from `(height, weight, category, preferredFit)` plus optional scan ratios. Category coefficients are split for `Men/Women/Kids` (anything else falls back to `Men`). Scan ratios are blended with a `scanQuality`-weighted multiplier.
3. **Heuristic candidate scoring** — for each size row `evaluate_candidate_size(...)` computes:
   - `delta = adjusted_measurement - target_measurement` per required field
   - `penalty` — asymmetric: tight (`delta < 0`) hurts ~3× more than loose (`1.1×` vs `0.35×`); length fields use absolute distance × `0.22`.
   - `fitScore` — weighted average of deltas (signed). Used as the regression label and for "too tight" / "too loose" reasoning.
   - `fieldBreakdown` — per-field penalties, sorted ascending, kept on the candidate dict.
   - `featureVector` — full 20-dim feature map for the model.
4. **Model scoring (optional)** — if the model is loaded, all candidate vectors are sent through `ModelService.predict_fit_scores`. The returned scores **overwrite** `fitScore` and the sort key becomes `abs(predicted_score)` (closest to zero = best fit). If the model returns nothing or a length mismatch, the pipeline **silently falls back to penalty sorting**.
5. **Confidence assembly** — combines:
   - `closeness_score = clamp(1 - sortScore/12, 0, 1)`
   - `margin_score` — gap to the runner-up, capped at `0.22`
   - `scan_bonus` — up to `+0.08` from `scanQuality`
   - Final formula: `clamp(0.38 + closeness*0.44 + margin + scan, 0.38, 0.97)`
6. **Range label** — only emitted when confidence < 0.6; preserves the order found in `product.sizes`.
7. **Reason** — picks the two lowest-penalty fields, tags with the stretch label, and adds a "too tight"/"too loose" suffix when `|fitScore| > 1.5`.
8. **Response** — `source` is `ml` whenever `predictionSource != "heuristic_fallback"`; otherwise `heuristic`. `meta` always carries the model version and load flag for audit.

---

## 8. Body Analysis Pipeline (deep)

Implemented in [app/services/body_analysis.py](app/services/body_analysis.py).

**Landmark branch (preferred).** Indexes follow MediaPipe BlazePose: 11/12 = shoulders, 23/24 = hips. Computes shoulder width, hip width, torso height (vertical mid-shoulder → mid-hip), and average visibility. Returns:

- `shoulderRatio = shoulder_width / hip_width`
- `hipRatio = hip_width / shoulder_width`
- `torsoRatio = torso_height / shoulder_width`
- `scanQuality = clamp(avg(visibility), 0, 1)`

**Image-only branch (fallback).** Decodes the data URL, reads JPEG/PNG dimensions from headers, and synthesizes ratios from aspect ratio and resolution. This is intentionally low-confidence: `scanQuality` is hard-capped at `0.58`, ratios stay within `±6%` of 1.0. It's a stop-gap until the real pose model is wired in.

**Failure modes:** missing landmarks/image → `501` (camera phase). Incomplete landmarks (< 25 points) or zero shoulder/hip width → `422`.

---

## 9. Feature Engineering

[app/services/feature_builder.py](app/services/feature_builder.py) is the heart of the ML system. Key tables:

- `MEASUREMENT_FIELDS` — 7 garment dims (chest, waist, hip, shoulder, sleeveLength, inseam, garmentLength).
- `LENGTH_FIELDS` — `{sleeveLength, inseam, garmentLength}` are treated symmetrically (no bias offset, length expectation is height-based).
- `FIELD_WEIGHTS` — chest 1.4, waist 1.25, hip 1.25, shoulder 1.15, lengths 0.55–0.8.
- `FIT_EASE_BY_FIELD` — slim/regular/relaxed ease per field in cm.
- `MEASUREMENT_TEMPLATES` — required field tuples per garment template.
- `CATEGORY_BODY_FACTORS` — linear regression-style coefficients for Men/Women/Kids over height & weight, used by `estimate_body_profile`.
- `FEATURE_ORDER` — the canonical 20-dim vector. **This list is the contract between training and inference**; any reorder breaks the artifact.

`get_target_measurement` derives the user's target garment dim by adding ease, then subtracting `stretch_score * (0.75|2.2)` so stretchy fabrics tolerate tighter ease.

`build_candidate_feature_map` produces the full feature dict including:
- 3 numeric body features (`heightCm`, `weightKg`, `bmi`)
- 2 one-hot fit prefs + 2 one-hot fit biases + 1 stretch
- 4 scan features (`scanQuality`, `shoulderRatio`, `hipRatio`, `torsoRatio`)
- 7 per-field deltas (missing measurements default to `-6.0` — a **strong magic number** that the model learns to interpret as "missing")
- `requiredCoverage` (0..1) to penalize products with sparse charts

`feature_map_to_vector` projects to `FEATURE_ORDER`. Anything outside the order is silently dropped.

---

## 10. Heuristic Fit Scoring

[app/services/fit_scoring.py](app/services/fit_scoring.py) computes both the **training label** (`fitScore`, signed weighted delta) and the **fallback rank** (`penalty`, asymmetric absolute). The asymmetry encodes domain knowledge: customers strongly prefer "slightly loose" over "slightly tight" for non-stretch garments.

Field breakdown is sorted ascending so the recommender can show "best two fields" without re-sorting on the API side.

---

## 11. Model Service & Artifact Loading

[app/services/model_service.py](app/services/model_service.py) is intentionally defensive:

- `load_model()` is **idempotent** — it always resets state first, so a failed reload doesn't half-poison the service.
- Accepts both legacy artifacts (a bare estimator with `.predict`) and the new dict shape `{"model": ..., "metadata": {...}}`.
- Recognises `GradientBoostedFitArtifact` as a special case to merge metadata.
- Falls back to heuristic mode and **logs a warning** if the artifact is missing or broken — the service never refuses to start.
- `predict_fit_scores(rows)` accepts a list-of-lists, normalizes the output (list / numpy / scalar) into `list[float]`. The `try/except TypeError` ladder is a no-op today (both branches are identical) — left over from an earlier API change and safe to remove.

[app/services/model_artifact.py](app/services/model_artifact.py) wraps an `xgboost.Booster` with the saved feature order and rebuilds a `DMatrix` per call. This works but allocates a fresh DMatrix every request — the optimization plan addresses this.

---

## 12. Training Stack

CLI entrypoint: `python -m train.train_model --rows 12000 --rounds 120 --external-source none|auto|renttherunway`.

Pipeline:

1. **`build_training_corpus`** — generates a synthetic dataset and (optionally) blends in real Rent the Runway reviews with a configurable per-row weight (default 0.35).
2. **`build_training_dataset`** ([train/build_dataset.py](train/build_dataset.py)) — generates ~150 synthetic products × ~12–24 user samples × all sizes, producing 12k candidate rows by default. Categories, templates and fit biases are sampled with documented priors. Body features are present in 65% of users.
3. **`load_rent_the_runway_training_dataset`** ([train/external_review_dataset.py](train/external_review_dataset.py)) — parses `renttherunway_final_data.json` (one JSON per line), normalizes height/weight from imperial strings, infers `measurementTemplate` from the free-text category, derives `fitBias` per item from the small/fit/large counts, and **synthesizes a pseudo size chart** from per-bucket body-profile averages with template-specific ease. The label per `(user, candidate_size)` is `candidate_index - ideal_index` (0 = perfect fit).
4. **`train_size_model`** — XGBoost `reg:squarederror`, `max_depth=5`, `eta=0.08`, `subsample=0.92`, `colsample_bytree=0.9`, `min_child_weight=4`, `tree_method=hist`. 80/20 random split. Reports RMSE/MAE plus `withinHalfPointRate` / `withinOnePointRate` — the latter two are the practically meaningful metrics ("did we land within ±1 size?").
5. **`save_model_artifact`** — pickles `{"model": GradientBoostedFitArtifact, "metadata": {...}}` and writes a sibling `*.metadata.json` for human inspection.

The shipped artifact's metadata reports validation `withinOnePointRate ≈ 0.84` on the synthetic-only corpus — a reasonable cold-start baseline.

---

## 13. Image Utilities

[app/utils/image_utils.py](app/utils/image_utils.py) parses a `data:image/...;base64,...` URL and reads dimensions **without decoding the pixels**:

- PNG: bytes 16–24 of the IHDR chunk.
- JPEG: walks the segment markers, finds an SOFn marker, reads height & width.

This is fast and avoids pulling Pillow into the runtime. Trade-off: it cannot validate the actual pixel payload, detect corruption, strip EXIF or normalize orientation. The optimization plan upgrades this.

---

## 14. Tests

- `test_recommendation.py` — happy path + missing fit data + ML vs heuristic source.
- `test_body_analysis.py` — landmark math + image header parsing + 501 path.
- `test_train_model.py` — synthetic corpus shape + train/save round-trip.
- `test_external_review_dataset.py` — RTR parsing + grouping + label inference.

Coverage is sufficient for the current surface but **no integration test** exercises the FastAPI app via `TestClient`, and there are no contract/schema tests against the Node server's caller.

---

## 15. Build, Packaging & Deployment

- **Local dev:** `pip install -r requirements.local.txt` then `uvicorn app.main:app --reload`.
- **Docker:** `python:3.12-slim` base, installs `requirements.local.txt` by default (`REQUIREMENTS_FILE` ARG can switch to `requirements.txt`). Copies only `app/` and `index.py`. Exposes 8000.
- **Vercel:** `index.py` re-exports the FastAPI `app` for the serverless adapter. The slim `requirements.txt` keeps the bundle under Vercel's limits (no numpy / xgboost). In that mode the model is **never loaded** and the service falls back to pure heuristics — by design.

There is no `docker-compose`, no Helm chart, no Render/Fly/Railway config and no CI workflow specific to ml-service.

---

## 16. Known Gaps, Risks & Smells

| # | Area | Issue | Impact |
| --- | --- | --- | --- |
| G1 | Reliability | No request timeout, no global error handler, no graceful shutdown | A single slow upstream (or huge image) can stall a worker |
| G2 | Reliability | `predict_fit_scores` silently swallows length mismatches | Bad predictions degrade silently; no alarm |
| G3 | Reliability | `load_model` only runs at startup; no `/reload-model` | New artifacts require a full process restart |
| G4 | Performance | New `xgb.DMatrix` per request | ~30–50% latency overhead on hot path |
| G5 | Performance | No batching, no caching | Recurring `(product, body)` pairs are recomputed |
| G6 | Performance | Default `lru_cache`-able tables rebuilt per call (e.g. ease lookups) | Minor, but adds up under load |
| G7 | Security | Shared secret comparison is `==`, not constant-time | Theoretical timing-attack surface |
| G8 | Security | No rate limit, no payload size cap, no CORS policy | DoS risk via large `imageBase64` |
| G9 | Security | Image dimensions are read from headers without bounds | Attacker-controlled `width/height` (e.g. zip-bomb-style decompression) is unchecked |
| G10 | Observability | Stdlib `logging` only, no structured logs, no request id | Hard to correlate with Node server logs |
| G11 | Observability | No Prometheus metrics, no OpenTelemetry traces | Blind in prod |
| G12 | ML Quality | Synthetic labels are derived from the *same* heuristic the model is supposed to improve | Risk of the model just learning the heuristic |
| G13 | ML Quality | No validation against held-out real reviews; no calibration | `confidence` is a hand-tuned formula, not a probability |
| G14 | ML Quality | Magic value `-6.0` for missing measurements | Model entangles "missing" with "very tight" |
| G15 | ML Quality | No drift monitoring, no shadow mode, no A/B | New artifacts ship blind |
| G16 | Data | RTR loader is single-pass, in-memory; no streaming, no parquet | Won't scale past a few hundred MB |
| G17 | Body analysis | Image fallback ratios are essentially `aspect_ratio * constant` | Adds noise more than signal |
| G18 | Body analysis | No real pose model, no segmentation, no anti-spoofing | Camera-mode launch is blocked |
| G19 | Contract | `meta: dict[str, str | bool]` is loose | Easy to break the consumer silently |
| G20 | Tests | No FastAPI `TestClient` coverage, no schema contract tests | Regressions in routing/validation slip through |

---

## 17. Advanced Optimization Plan

The goal is to make the service **advanced, reliable and perfect** — meaning: deterministic under load, observable end-to-end, defensible against malicious clients, continuously improved by real feedback, and safe to deploy without fear.

### 17.1 Reliability & Resilience

**R1. Global error handler & request-id middleware.** Add a FastAPI `exception_handler(Exception)` that returns `{requestId, code, message}`, never leaks stack traces in `production`, and logs the traceback at `error`. Add a middleware that mints a UUID v7 request id, echoes it back in `X-Request-Id`, and binds it to the logger context.

**R2. Hard request timeout.** Wrap the route bodies in `asyncio.wait_for(asyncio.to_thread(...), timeout=settings.request_timeout_seconds)`. Default 3s for `/recommend-size`, 6s for `/analyze-body`. On timeout return `504` with the request id.

**R3. Payload guards.** Reject `imageBase64` payloads larger than `settings.max_image_bytes` (default 2 MB) **before** decoding. Reject pose `landmarks` longer than 64 points. Cap `sizeMeasurements` at 25 rows.

**R4. Defensive prediction parity.** In `predict_fit_scores` raise (don't swallow) when `len(predictions) != len(rows)`. The route turns it into a `502` and the recommender falls back to heuristics with a `predictionSource="model_length_mismatch"` tag for telemetry.

**R5. Hot model reload.** Add `POST /admin/reload-model` (guarded by a separate `ML_ADMIN_SECRET`) that calls `model_service.load_model()` under an `asyncio.Lock`. Add `GET /ready` which returns 503 until the first load attempt completes.

**R6. Graceful shutdown.** Extend `lifespan` with a shutdown branch that drains in-flight requests (uvicorn already does this) and closes any future connections (DB, S3, Redis).

**R7. Single source of truth for "did we use the model?".** Replace the magic string compare (`prediction_source != "heuristic_fallback"`) with an enum (`PredictionSource.MODEL`, `.HEURISTIC`, `.MODEL_LENGTH_MISMATCH`, `.MODEL_ERROR`).

### 17.2 Performance & Throughput

**P1. Persistent DMatrix & feature-name caching.** Keep `feature_names` on the artifact and reuse a thread-local `xgb.DMatrix` builder. For batched requests (`>= 32` rows), use `xgb.QuantileDMatrix` to skip histogram rebuild.

**P2. Vectorized feature builder.** Move `build_candidate_feature_map` from per-candidate Python loops to a single NumPy assembly when more than 4 sizes are evaluated. Pre-compute a `(candidates, 20)` matrix and call `predict` once. Today the loop is fine because there are usually ≤ 8 sizes, but the refactor is trivial and removes a future hot spot.

**P3. Result cache.** Add an in-process LRU keyed by `(productId or hash(sizeChart), userMetricsHash, bodyFeaturesHash, modelVersion)` with `maxsize=2048`, TTL 10 minutes. Invalidate on `/admin/reload-model`.

**P4. Async I/O for image decode.** Run `decode_data_url_image` via `asyncio.to_thread`, freeing the event loop.

**P5. Worker model.** Document and ship `gunicorn -k uvicorn.workers.UvicornWorker -w $((2*CPU+1)) --max-requests 5000 --max-requests-jitter 500` for the container CMD. Justification: XGBoost releases the GIL during predict, so process-per-CPU is the right default.

**P6. Warm the model.** After `load_model()` succeeds, run a tiny warm-up `predict` with a synthetic 4-row matrix so the first real request doesn't pay JIT/cold-cache cost.

**P7. Avoid Pydantic re-serialisation.** Where the response is built from the same fields multiple times (`alternatives` building), cache `best_candidate["sortScore"]` once.

### 17.3 Security & Hardening

**S1. Constant-time secret check.** Use `secrets.compare_digest`. Require `len(settings.shared_secret) >= 24` at startup or refuse to boot in `production`.

**S2. Rate limiting.** Add `slowapi` (or a tiny token-bucket middleware) keyed by `(client IP, route)`. Defaults: 60 rpm for `/recommend-size`, 20 rpm for `/analyze-body`, 600 rpm for `/health`.

**S3. CORS.** The service is server-to-server today; explicitly set `allow_origins=[]` so a misconfiguration cannot accidentally expose it to browsers.

**S4. Image safety.** After header parsing, enforce `width <= 4096`, `height <= 4096`, `width*height <= 12_000_000`. Optionally pull in `pyvips` (out-of-process) for real validation in the camera phase.

**S5. Strip PII from logs.** Never log `imageBase64`, `userMetrics`, or `landmarks`. Log only the request id, route, status, latency, source, model version, and aggregate sizes.

**S6. Dependency hygiene.** Pin `pip-audit` in CI. Bump pydantic/fastapi monthly. Pin xgboost and joblib by sha256 in `requirements.lock` (use `pip-compile --generate-hashes`).

**S7. Container hardening.** Run as a non-root user (`USER 1000`), `--read-only` rootfs except `/tmp`, drop all capabilities. Add a `HEALTHCHECK` directive in the Dockerfile.

**S8. Replay protection (optional).** Add an `X-Request-Timestamp` + HMAC of the body so a leaked secret cannot be replayed indefinitely.

### 17.4 Observability

**O1. Structured logging.** Replace stdlib logging with `structlog` JSON output: `timestamp`, `level`, `event`, `request_id`, `route`, `status`, `latency_ms`, `model_version`, `prediction_source`, `candidate_count`, `confidence_bucket`.

**O2. Prometheus metrics.** Expose `/metrics` (guarded by IP allowlist or admin secret) with:
- `ml_request_latency_seconds{route,status}` histogram
- `ml_recommend_confidence` histogram
- `ml_recommend_source_total{source}` counter
- `ml_model_loaded` gauge
- `ml_model_version_info{version}` gauge (always 1)
- `ml_predict_batch_size` histogram

**O3. OpenTelemetry traces.** Use `opentelemetry-instrumentation-fastapi` so requests join the same trace as the Node server. Attach `model.version`, `prediction.source`, `confidence` as span attributes.

**O4. Audit log of recommendations.** Emit a sampled (~5%) JSON line with the full request fingerprint + response — fed to S3/BigQuery/Loki for offline analysis. Strictly redact body images.

**O5. Health vs Readiness.** Split `/health` (process alive) from `/ready` (model loaded *or* explicitly running in heuristic mode). The Node side should probe `/ready` before sending real traffic.

### 17.5 ML Quality & MLOps

**M1. Real-feedback loop.** The Node side already has `fitFeedbackModel`. Define a nightly job that:
1. Pulls the last 24h of feedback (`actual_size`, `would_buy_again`, `fit_label`).
2. Joins with the original request snapshot persisted from O4.
3. Emits a parquet file partitioned by date to `s3://lavish-fit/feedback/...`.

**M2. Replace synthetic labels with real labels in fine-tuning.** Train a base model on synthetic + RTR (current pipeline), then **fine-tune** with low learning rate on the real-feedback parquet. Use `xgboost`'s `xgb_model=` continuation to warm-start from the previous booster.

**M3. Calibration.** Replace the hand-tuned confidence formula with **isotonic regression** trained on `(predicted |fitScore|, was_correct)` pairs. Output a true probability that the recommended size is correct.

**M4. Encode "missing" properly.** Replace the `-6.0` magic value with `np.nan` and let XGBoost's native NaN handling learn the missing-direction split per node. Re-train and compare validation metrics.

**M5. Per-segment metrics.** Report `withinOnePointRate` broken down by `(category, fitBias, preferredFit)`. Block deployment if any segment regresses by > 3 percentage points vs the current production artifact.

**M6. Model registry.** Persist artifacts to S3/GCS as `models/{modelVersion}/{trainedAt}.joblib` plus `metadata.json` and a `MANIFEST.sha256`. The service reads `MODEL_URI` (e.g. `s3://...`) instead of a local path. Add `joblib.load` over an in-memory buffer to avoid local FS dependency.

**M7. Shadow mode.** When two artifacts are configured (`MODEL_URI_PRIMARY`, `MODEL_URI_SHADOW`), run both, return the primary, log the shadow's score + decision diff. Shadow runs are sampled to 25% to control cost.

**M8. Canary & rollback.** On `/admin/reload-model`, only switch traffic when the warm-up predict on a 200-row golden sample matches the registered metrics within tolerance. Otherwise revert and alert.

**M9. Reproducibility.** Persist the `pip freeze` and the `git rev-parse HEAD` inside `metadata.json`. Persist the dataset hash (sha256 of the sorted feature matrix bytes).

**M10. Deterministic training.** Set `PYTHONHASHSEED`, `np.random.default_rng(seed)`, and pass `seed` into `xgb.train`. Today the seed is wired but the env var isn't — trivial fix.

### 17.6 Data Pipeline

**D1. Streaming RTR loader.** Replace the in-memory `defaultdict(list)` with a two-pass scan: pass 1 counts records per item id, pass 2 streams only items above the threshold. Drops peak memory by ~10×.

**D2. Persist intermediate datasets.** Save `build_training_corpus` output as parquet in `train/data/` so re-training doesn't redo dataset construction. Hash the inputs for cache invalidation.

**D3. ModCloth dataset.** The repo already contains `modcloth_final_data.json`. Add a parallel loader for it and blend with a configurable weight; document why it was previously deprioritised so the decision is reversible.

**D4. Sample-weight strategy.** Today external rows get a flat 0.35 weight. Replace with a per-record weight inversely proportional to item review count, so popular dresses don't dominate the loss.

**D5. Train/val/test split by item id.** The current random split leaks: rows from the same product can land in both train and val, inflating metrics. Group-shuffle by `itemId` (use `sklearn.model_selection.GroupShuffleSplit`).

### 17.7 Body Analysis Roadmap

**B1. Real pose model in-service.** Land MediaPipe Pose (or Ultralytics YOLO-Pose) behind a feature flag. Run inference inside `asyncio.to_thread`. Cap CPU time per request.

**B2. Segmentation for silhouette ratios.** Use `mediapipe.SelfieSegmentation` to derive shoulder-to-hip width from the actual silhouette, not just landmarks. This is robust to loose clothing.

**B3. Multi-frame fusion.** Accept up to 3 frames in `analyze-body`. Aggregate ratios with median; report `scanQuality` as `min(visibility) * frame_agreement`.

**B4. Anti-spoofing & quality gates.** Reject obviously occluded frames (visibility < 0.4 on key joints), upside-down frames, and frames smaller than 480p before running pose.

**B5. EXIF normalisation.** Honor EXIF orientation before parsing dimensions. Today a portrait phone photo can read as landscape and skew `aspect_ratio`.

**B6. On-device path.** Long term, ship the same model as a TFLite/ONNX bundle to the client and have the ML service only verify summarised features (HMAC-signed). Cuts bandwidth and latency, improves privacy.

### 17.8 API & Contract Evolution

**A1. Versioned routes.** Move existing routes under `/v1/`. Reserve `/v2/` for breaking changes (probability-calibrated confidence, multi-frame body analysis).

**A2. Strong meta typing.** Replace `meta: dict[str, str | bool]` in `AnalyzeBodyResponse` with a typed `AnalyzeBodyMeta` Pydantic model.

**A3. OpenAPI examples.** Add `examples` to every schema. Publish `openapi.json` to the Node repo as a `package.json` artifact so the client SDK is generated, not handwritten.

**A4. Idempotency keys.** Honor `Idempotency-Key` header on `/recommend-size` — return the cached response for 10 minutes when the same key is replayed.

**A5. Feedback ingestion.** Add `POST /v1/feedback` so the Node server can stream actual outcomes (`requestId`, `recommendedSize`, `purchasedSize`, `kept`, `fitLabel`). The endpoint just buffers to disk/Kafka — training is offline.

### 17.9 Testing Strategy

**T1. FastAPI `TestClient` integration tests** for every route, including 401, 422, 501, 504, oversized payload, malformed image.

**T2. Property-based tests** with `hypothesis` over `RecommendationRequest`: assert that confidence is always in `[0.38, 0.97]`, that recommended size is always one of the input sizes, that `alternatives` are strict subsets of `product.sizes`.

**T3. Golden-master tests.** Snapshot 50 hand-curated `(request, response)` pairs. The model artifact is the same one the test pins; any model swap regenerates and code-reviews the snapshot diff.

**T4. Performance budget tests.** A pytest-benchmark suite that fails CI if `recommend_size` p95 > 25 ms or `analyze_body (landmarks)` p95 > 10 ms on the CI runner.

**T5. Contract tests vs Node.** Use `schemathesis` against the published OpenAPI spec in the Node repo's CI.

**T6. Mutation testing.** Run `mutmut` weekly on the `services/` package — surface untested branches in the heuristic and reason builder.

### 17.10 Deployment & Infrastructure

**I1. Dedicated GitHub Actions workflow** (`.github/workflows/ml-service.yml`):
- `ruff check`, `ruff format --check`, `mypy --strict`, `pytest -q`, `pip-audit`.
- Build & push the Docker image tagged with the commit sha to GHCR/ECR.
- On `main`, deploy to staging; gated manual promotion to prod.

**I2. Helm chart / Render blueprint / Fly.toml** — pick one and commit it. Today the deploy story is implicit.

**I3. Multi-stage Dockerfile.** Build wheels in a fat builder, copy the slim wheels into a `python:3.12-slim` runtime. Final image should be < 350 MB even with xgboost.

**I4. Health-aware autoscaler.** Scale on `ml_request_latency_seconds:p95 > 200ms` for 5 minutes, not on CPU. Min 2 replicas in prod for HA.

**I5. Disaster recovery.** Document the steps to restore from S3 model registry + last good `metadata.json`. RPO 24h, RTO 1h.

### 17.11 Cost & FinOps

**F1. Right-size the model.** XGBoost with `max_depth=5` and 120 rounds is < 5 MB; the artifact is fine. Don't grow it without measuring `validationMetrics.withinOnePointRate` lift.

**F2. Cold-start vs warm-start economics.** On Vercel the model never loads — that's fine for free-tier traffic but should fail closed once paid traffic exists. Document the exact RPS where moving to a long-running container becomes cheaper than serverless cold starts.

**F3. Cache hits = revenue.** The LRU cache from P3 directly cuts compute. Track `ml_cache_hits_total` and target ≥ 30% hit rate on the top 1000 products.

### 17.12 Governance, Privacy & Compliance

**G-Priv-1.** `imageBase64` is biometric data in some jurisdictions. Default to **never persist**, log only `(width, height, scanQuality)`. Make persistence a per-tenant opt-in flag for the camera phase.

**G-Priv-2.** Add a `/v1/forget` admin endpoint that, given a `userId`, drops cached recommendations and feedback rows attributable to that user.

**G-Priv-3.** Document the model card: training data, intended use, known biases (RTR is US-women-skewed; Kids template is sparse), evaluation segments, fairness checks.

**G-Priv-4.** Bias guardrails. Track `withinOnePointRate` per `(category, BMI bucket)`. Block deploys that regress any underrepresented segment.

---

## 18. Phased Execution Roadmap

**Phase 0 — Foundations (low risk, high leverage).** R1, R2, R3, S1, S2, S5, O1, O5, T1.
Outcome: production-safe service, observable, rate-limited, with integration tests.

**Phase 1 — Performance & Hot Reload.** P1, P2, P3, P5, P6, R4, R5, R6, A2, A3.
Outcome: faster, hot-swappable, contract-stable.

**Phase 2 — MLOps Loop.** M1, M2, M3, M4, M5, M6, M9, M10, D2, D5, A5.
Outcome: real feedback drives the model; deployments are auditable and reproducible.

**Phase 3 — Camera Phase.** B1, B2, B3, B4, B5, S4, G-Priv-1, A1.
Outcome: real body analysis goes live with privacy + safety guardrails.

**Phase 4 — Scale & Govern.** M7, M8, I1–I5, T3, T4, T5, F1–F3, G-Priv-2..4.
Outcome: shadow + canary, autoscaled, governed.

---

## 19. Acceptance Criteria & SLOs

| Metric | Target |
| --- | --- |
| `/recommend-size` p95 latency (model loaded) | ≤ 80 ms |
| `/recommend-size` p99 latency | ≤ 200 ms |
| `/analyze-body` (landmarks) p95 | ≤ 30 ms |
| `/analyze-body` (image, pose model) p95 | ≤ 350 ms |
| Availability (rolling 30d) | ≥ 99.9% |
| Error budget burn alert | 2× rate over 1h |
| `withinOnePointRate` (validation, real feedback) | ≥ 0.85 |
| Per-segment regression on deploy | ≤ 3pp |
| Cache hit rate (top 1000 products) | ≥ 30% |
| Mean time to model rollback | ≤ 5 min |

A change is "done" when it ships behind a flag, has metrics, has tests, has a runbook entry, and has been observed in staging for ≥ 24h without regression.

---

## 20. Appendix — Feature Vector Reference

The canonical 20-dim feature order (must match `FEATURE_ORDER` in [app/services/feature_builder.py](app/services/feature_builder.py)):

| Index | Name | Range | Semantics |
| --- | --- | --- | --- |
| 0 | `heightCm` | 50–260 | User height |
| 1 | `weightKg` | 20–350 | User weight |
| 2 | `bmi` | derived | `weight / height²` |
| 3 | `preferredFitSlim` | 0/1 | One-hot |
| 4 | `preferredFitRelaxed` | 0/1 | One-hot |
| 5 | `stretchScore` | 0–1 | Product stretch |
| 6 | `fitBiasRunsSmall` | 0/1 | One-hot |
| 7 | `fitBiasRunsLarge` | 0/1 | One-hot |
| 8 | `scanQuality` | 0–1 | Body-feature confidence |
| 9 | `shoulderRatio` | ~0.85–1.18 | Scan ratio (1 = average) |
| 10 | `hipRatio` | ~0.85–1.18 | Scan ratio |
| 11 | `torsoRatio` | ~0.9–1.16 | Scan ratio |
| 12 | `chestDelta` | cm | `garment - target` (negative = tight) |
| 13 | `waistDelta` | cm | same |
| 14 | `hipDelta` | cm | same |
| 15 | `shoulderDelta` | cm | same |
| 16 | `sleeveLengthDelta` | cm | length, symmetric penalty |
| 17 | `inseamDelta` | cm | length, symmetric penalty |
| 18 | `garmentLengthDelta` | cm | length, symmetric penalty |
| 19 | `requiredCoverage` | 0–1 | Fraction of required template fields present |

Missing measurements are encoded today as `-6.0`. After M4 they become `NaN` and the index meaning is unchanged.

---

*Document generated for the `ml-service` package. Treat sections 1–16 as the current baseline and section 17 as the contract for the next four engineering phases. Update both halves whenever the service evolves.*
