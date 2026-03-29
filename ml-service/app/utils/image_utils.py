from __future__ import annotations

import base64
import binascii
from typing import Tuple


def decode_data_url_image(image_base64: str) -> tuple[str, bytes]:
    raw_value = str(image_base64 or "").strip()
    if not raw_value.startswith("data:image/") or "," not in raw_value:
        raise ValueError("A valid base64 image payload is required.")

    header, encoded_data = raw_value.split(",", 1)
    mime_type = header.split(";")[0].replace("data:", "").strip().lower()

    try:
        decoded_bytes = base64.b64decode(encoded_data, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("The image payload could not be decoded.") from exc

    if not decoded_bytes:
        raise ValueError("The image payload is empty.")

    return mime_type, decoded_bytes


def get_image_dimensions(image_bytes: bytes) -> Tuple[int, int]:
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        if len(image_bytes) < 24:
            raise ValueError("The PNG image is truncated.")

        width = int.from_bytes(image_bytes[16:20], "big")
        height = int.from_bytes(image_bytes[20:24], "big")
        return width, height

    if image_bytes[:2] == b"\xff\xd8":
        offset = 2
        while offset < len(image_bytes):
            if image_bytes[offset] != 0xFF:
                offset += 1
                continue

            while offset < len(image_bytes) and image_bytes[offset] == 0xFF:
                offset += 1

            if offset >= len(image_bytes):
                break

            marker = image_bytes[offset]
            offset += 1

            if marker in {0xD8, 0xD9}:
                continue

            if offset + 1 >= len(image_bytes):
                break

            segment_length = int.from_bytes(image_bytes[offset:offset + 2], "big")
            if segment_length < 2:
                break

            if marker in {
                0xC0,
                0xC1,
                0xC2,
                0xC3,
                0xC5,
                0xC6,
                0xC7,
                0xC9,
                0xCA,
                0xCB,
                0xCD,
                0xCE,
                0xCF
            }:
                if offset + 7 >= len(image_bytes):
                    break

                height = int.from_bytes(image_bytes[offset + 3:offset + 5], "big")
                width = int.from_bytes(image_bytes[offset + 5:offset + 7], "big")
                return width, height

            offset += segment_length

        raise ValueError("The JPEG image dimensions could not be determined.")

    raise ValueError("Unsupported image format. Use JPEG or PNG.")
