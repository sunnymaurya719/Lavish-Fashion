from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.schemas.request_models import RecommendationRequest
from app.services.model_service import ModelService
from app.services.recommendation_service import RecommendationService
from train.build_dataset import build_training_dataset
from train.train_model import save_model_artifact, train_size_model


class RecommendationPipelineTests(unittest.TestCase):
    def test_training_pipeline_produces_a_loadable_ml_artifact(self) -> None:
        dataset = build_training_dataset(row_target=1_200, seed=9)
        artifact_payload, metadata = train_size_model(
            dataset,
            seed=9,
            num_boost_round=45,
            model_version="xgb-fit-test",
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            artifact_path = Path(temp_dir) / "size_recommender.joblib"
            save_model_artifact(artifact_payload, artifact_path)

            model_service = ModelService(artifact_path=artifact_path, base_model_version="xgb-fit-test")
            self.assertTrue(model_service.load_model())
            self.assertTrue(model_service.model_loaded)
            self.assertEqual(model_service.model_version, metadata["modelVersion"])

            recommendation_service = RecommendationService(model_service)
            response = recommendation_service.recommend_size(
                RecommendationRequest.model_validate(
                    {
                        "mode": "manual",
                        "product": {
                            "id": "shirt-001",
                            "category": "Men",
                            "sizes": ["S", "M", "L", "XL"],
                            "sizeScale": "alpha",
                            "fitProfileSummary": {"ready": True, "measurementTemplate": "topwear"},
                            "fitProfile": {
                                "measurementTemplate": "topwear",
                                "fitBias": "true_to_size",
                                "stretchScore": 0.35,
                                "sizeMeasurements": [
                                    {"size": "S", "chest": 95, "shoulder": 42, "garmentLength": 68},
                                    {"size": "M", "chest": 101, "shoulder": 44, "garmentLength": 70},
                                    {"size": "L", "chest": 107, "shoulder": 46, "garmentLength": 72},
                                    {"size": "XL", "chest": 113, "shoulder": 48, "garmentLength": 74},
                                ],
                            },
                        },
                        "userMetrics": {
                            "heightCm": 178,
                            "weightKg": 74,
                            "preferredFit": "regular",
                        },
                    }
                )
            )

            self.assertTrue(response.meta.modelLoaded)
            self.assertEqual(response.meta.predictionSource, "xgboost_regressor")
            self.assertEqual(response.source, "ml")
            self.assertIn(response.recommendation.size, {"S", "M", "L", "XL"})
            self.assertGreater(response.recommendation.confidence, 0.3)


if __name__ == "__main__":
    unittest.main()
