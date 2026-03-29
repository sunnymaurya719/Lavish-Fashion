from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from train.external_review_dataset import (
    load_rent_the_runway_training_dataset,
    map_rtr_category_to_template,
    parse_height_to_cm,
    parse_weight_to_kg,
)


class ExternalReviewDatasetTests(unittest.TestCase):
    def test_rtr_parsers_normalize_height_weight_and_category(self) -> None:
        self.assertEqual(parse_height_to_cm("5' 8\""), 172.72)
        self.assertEqual(parse_weight_to_kg("137lbs"), 62.14)
        self.assertEqual(map_rtr_category_to_template("gown"), "dress")
        self.assertEqual(map_rtr_category_to_template("blazer"), "outerwear")

    def test_rtr_loader_builds_candidate_training_rows(self) -> None:
        sample_rows = [
            {
                "fit": "fit",
                "user_id": "1",
                "bust size": "34b",
                "item_id": "dress-1",
                "weight": "128lbs",
                "rating": "10",
                "rented for": "wedding",
                "body type": "hourglass",
                "review_summary": "Perfect",
                "category": "dress",
                "height": "5' 6\"",
                "size": 8,
            },
            {
                "fit": "small",
                "user_id": "2",
                "bust size": "34c",
                "item_id": "dress-1",
                "weight": "140lbs",
                "rating": "8",
                "rented for": "wedding",
                "body type": "athletic",
                "review_summary": "Needed bigger",
                "category": "dress",
                "height": "5' 7\"",
                "size": 8,
            },
            {
                "fit": "fit",
                "user_id": "3",
                "bust size": "36b",
                "item_id": "dress-1",
                "weight": "150lbs",
                "rating": "10",
                "rented for": "party",
                "body type": "pear",
                "review_summary": "Great",
                "category": "dress",
                "height": "5' 8\"",
                "size": 10,
            },
            {
                "fit": "large",
                "user_id": "4",
                "bust size": "32b",
                "item_id": "dress-1",
                "weight": "120lbs",
                "rating": "8",
                "rented for": "party",
                "body type": "petite",
                "review_summary": "Needed smaller",
                "category": "dress",
                "height": "5' 4\"",
                "size": 10,
            },
            {
                "fit": "fit",
                "user_id": "5",
                "bust size": "38c",
                "item_id": "dress-1",
                "weight": "165lbs",
                "rating": "10",
                "rented for": "work",
                "body type": "full bust",
                "review_summary": "Worked",
                "category": "dress",
                "height": "5' 9\"",
                "size": 12,
            },
            {
                "fit": "large",
                "user_id": "6",
                "bust size": "36c",
                "item_id": "dress-1",
                "weight": "148lbs",
                "rating": "8",
                "rented for": "work",
                "body type": "athletic",
                "review_summary": "Sized down",
                "category": "dress",
                "height": "5' 7\"",
                "size": 12,
            },
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            dataset_path = Path(temp_dir) / "rtr_sample.jsonl"
            with dataset_path.open("w", encoding="utf-8") as output_file:
                for row in sample_rows:
                    output_file.write(json.dumps(row) + "\n")

            dataset = load_rent_the_runway_training_dataset(
                path=dataset_path,
                max_reviews=20,
                min_item_reviews=3,
            )

        self.assertGreater(len(dataset["features"]), 0)
        self.assertEqual(dataset["summary"]["source"], "renttherunway")
        self.assertEqual(dataset["summary"]["eligibleItems"], 1)
        self.assertIn("dress", dataset["summary"]["templateCounts"])

    def test_rtr_loader_uses_review_limit_for_supervised_rows_not_early_scan_cutoff(self) -> None:
        sample_rows = [
            {
                "fit": "fit",
                "item_id": f"single-{index}",
                "weight": "130lbs",
                "body type": "athletic",
                "category": "dress",
                "height": "5' 6\"",
                "size": 8,
            }
            for index in range(4)
        ]
        sample_rows.extend(
            [
                {
                    "fit": "fit",
                    "item_id": "dress-cluster",
                    "weight": "128lbs",
                    "body type": "hourglass",
                    "category": "dress",
                    "height": "5' 6\"",
                    "size": 8,
                },
                {
                    "fit": "small",
                    "item_id": "dress-cluster",
                    "weight": "140lbs",
                    "body type": "athletic",
                    "category": "dress",
                    "height": "5' 7\"",
                    "size": 8,
                },
                {
                    "fit": "fit",
                    "item_id": "dress-cluster",
                    "weight": "150lbs",
                    "body type": "pear",
                    "category": "dress",
                    "height": "5' 8\"",
                    "size": 10,
                },
            ]
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            dataset_path = Path(temp_dir) / "rtr_scan_limit_sample.jsonl"
            with dataset_path.open("w", encoding="utf-8") as output_file:
                for row in sample_rows:
                    output_file.write(json.dumps(row) + "\n")

            dataset = load_rent_the_runway_training_dataset(
                path=dataset_path,
                max_reviews=3,
                min_item_reviews=3,
            )

        self.assertEqual(dataset["summary"]["acceptedReviews"], 7)
        self.assertEqual(dataset["summary"]["usedReviews"], 3)
        self.assertEqual(dataset["summary"]["eligibleItems"], 1)
        self.assertGreater(len(dataset["features"]), 0)


if __name__ == "__main__":
    unittest.main()
