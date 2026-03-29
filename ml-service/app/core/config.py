from dataclasses import dataclass
from pathlib import Path
import os


def _normalize_secret(value: str | None) -> str:
    return str(value or "").strip()


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("ML_APP_NAME", "Lavish Fit ML Service").strip()
    app_env: str = os.getenv("ML_APP_ENV", "development").strip().lower()
    model_version: str = os.getenv("MODEL_VERSION", "xgb-fit-v1").strip()
    model_path: Path = Path(os.getenv("MODEL_PATH", "app/models/size_recommender.joblib")).resolve()
    shared_secret: str = _normalize_secret(os.getenv("ML_SERVICE_SHARED_SECRET"))


settings = Settings()
