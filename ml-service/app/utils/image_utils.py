from __future__ import annotations

import base64
import binascii
from typing import Tuple

from app.core.config import settings


def decode_data_url_image(image_base64: str) -> tuple[str, bytes]:
    raw_value = str(image_base64 or "").strip()
    if not raw_value.startswith("data:image/") or "," not in raw_value:
        raise ValueError("A valid base64 image payload is required.")

    if len(raw_value) > _max_data_url_length():
        raise ValueError("The image payload exceeds the maximum allowed size.")

    header, encoded_data = raw_value.split(",", 1)
    mime_type = header.split(";")[0].replace("data:", "").strip().lower()

    allowed_mime_types = settings.allowed_image_mime_types
    if allowed_mime_types and mime_type not in allowed_mime_types:
        raise ValueError(
            "The image payload uses an unsupported format. "
            f"Allowed types: {', '.join(allowed_mime_types)}."
        )

    try:
        decoded_bytes = base64.b64decode(encoded_data, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("The image payload could not be decoded.") from exc

    if not decoded_bytes:
        raise ValueError("The image payload is empty.")

    if len(decoded_bytes) > settings.max_image_bytes:
        raise ValueError("The image payload exceeds the maximum allowed size.")

    return mime_type, decoded_bytes


def _max_data_url_length() -> int:
    # Base64 inflates the byte count by ~4/3 plus the data-URL prefix overhead.
    return int(settings.max_image_bytes * 1.4) + 256


def _enforce_dimension_bounds(width: int, height: int) -> None:
    if width <= 0 or height <= 0:
        raise ValueError("The scan image dimensions are invalid.")

    max_dim = settings.max_image_dimension
    if width > max_dim or height > max_dim:
        raise ValueError("The scan image is too large in one dimension.")

    if width * height > settings.max_image_pixels:
        raise ValueError("The scan image is too large in total pixels.")


def get_image_dimensions(image_bytes: bytes) -> Tuple[int, int]:
    width, height = _read_raw_dimensions(image_bytes)
    orientation = _read_jpeg_exif_orientation(image_bytes) if image_bytes[:2] == b"\xff\xd8" else 1
    if orientation in {5, 6, 7, 8}:
        # EXIF orientations 5-8 indicate the stored pixels are rotated 90/270°.
        # Swap width/height so downstream aspect-ratio heuristics see the real
        # display dimensions rather than the on-disk ones.
        width, height = height, width
    _enforce_dimension_bounds(width, height)
    return width, height


def _read_jpeg_exif_orientation(image_bytes: bytes) -> int:
    """Return the EXIF Orientation tag (1 = normal) for a JPEG payload.

    Returns ``1`` if the payload is not a JPEG, has no EXIF APP1 segment, or
    the segment cannot be parsed safely. The implementation only walks the
    EXIF IFD0 looking for tag ``0x0112`` (Orientation) and never decodes
    pixels, so it is safe against image bombs.
    """
    try:
        offset = 2
        while offset + 4 < len(image_bytes):
            if image_bytes[offset] != 0xFF:
                offset += 1
                continue
            while offset < len(image_bytes) and image_bytes[offset] == 0xFF:
                offset += 1
            if offset >= len(image_bytes):
                return 1
            marker = image_bytes[offset]
            offset += 1
            if marker in {0xD8, 0xD9}:
                continue
            if offset + 1 >= len(image_bytes):
                return 1
            segment_length = int.from_bytes(image_bytes[offset:offset + 2], "big")
            if segment_length < 2 or offset + segment_length > len(image_bytes):
                return 1
            if marker == 0xE1 and image_bytes[offset + 2:offset + 8] == b"Exif\x00\x00":
                tiff_start = offset + 8
                if tiff_start + 8 > len(image_bytes):
                    return 1
                byte_order = image_bytes[tiff_start:tiff_start + 2]
                endian = "little" if byte_order == b"II" else "big" if byte_order == b"MM" else None
                if endian is None:
                    return 1
                magic = int.from_bytes(image_bytes[tiff_start + 2:tiff_start + 4], endian)
                if magic != 0x002A:
                    return 1
                ifd_offset = int.from_bytes(image_bytes[tiff_start + 4:tiff_start + 8], endian)
                ifd_position = tiff_start + ifd_offset
                if ifd_position + 2 > len(image_bytes):
                    return 1
                entry_count = int.from_bytes(image_bytes[ifd_position:ifd_position + 2], endian)
                ifd_position += 2
                for _ in range(entry_count):
                    if ifd_position + 12 > len(image_bytes):
                        return 1
                    tag = int.from_bytes(image_bytes[ifd_position:ifd_position + 2], endian)
                    if tag == 0x0112:
                        value = int.from_bytes(image_bytes[ifd_position + 8:ifd_position + 10], endian)
                        if 1 <= value <= 8:
                            return value
                        return 1
                    ifd_position += 12
                return 1
            offset += segment_length
    except (IndexError, ValueError):
        return 1
    return 1


def _read_raw_dimensions(image_bytes: bytes) -> Tuple[int, int]:
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
