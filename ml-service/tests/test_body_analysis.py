from __future__ import annotations

import unittest

from app.schemas.request_models import AnalyzeBodyRequest
from app.services.body_analysis import analyze_body_request


SAMPLE_PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg=="
)


class BodyAnalysisTests(unittest.TestCase):
    def test_landmark_analysis_returns_normalized_features(self) -> None:
        landmarks = [{"x": 0.5, "y": 0.5, "visibility": 0.9} for _ in range(33)]
        landmarks[11] = {"x": 0.35, "y": 0.28, "visibility": 0.96}
        landmarks[12] = {"x": 0.65, "y": 0.28, "visibility": 0.94}
        landmarks[23] = {"x": 0.4, "y": 0.68, "visibility": 0.9}
        landmarks[24] = {"x": 0.6, "y": 0.68, "visibility": 0.92}

        response = analyze_body_request(AnalyzeBodyRequest(heightCm=176, landmarks=landmarks))

        self.assertEqual(response.meta["source"], "landmarks")
        self.assertGreater(response.bodyFeatures.shoulderRatio, 1)
        self.assertGreater(response.bodyFeatures.scanQuality, 0.9)

    def test_image_heuristic_analysis_accepts_data_url_images(self) -> None:
        response = analyze_body_request(AnalyzeBodyRequest(heightCm=168, imageBase64=SAMPLE_PNG_DATA_URL))

        self.assertEqual(response.meta["source"], "image_heuristic")
        self.assertGreaterEqual(response.bodyFeatures.scanQuality, 0.24)
        self.assertLessEqual(response.bodyFeatures.scanQuality, 0.58)


if __name__ == "__main__":
    unittest.main()
