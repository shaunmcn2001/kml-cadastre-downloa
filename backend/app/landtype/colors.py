# app/colors.py
import hashlib
from typing import Any, Optional, Tuple

from ..property_config import BORE_STATUS_COLORS, WATER_LAYER_COLORS
from .color_map import LANDTYPE_COLOR_MAP


def _clean_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _rgb_to_hex(rgb: Tuple[int, int, int]) -> str:
    r, g, b = rgb
    return f"#{max(0, min(255, r)):02x}{max(0, min(255, g)):02x}{max(0, min(255, b)):02x}"


# Deterministic color from code string; returns (R,G,B) 0-255
def color_from_code(code: str) -> Tuple[int,int,int]:
    s = (code or "UNK").encode("utf-8")
    h = hashlib.sha1(s).hexdigest()
    r = 60 + (int(h[0:2], 16) % 156)
    g = 60 + (int(h[2:4], 16) % 156)
    b = 60 + (int(h[4:6], 16) % 156)
    return (r, g, b)


def color_for_landtype(props: dict) -> Optional[str]:
    """Return deterministic colour for a land type feature."""
    code_candidates = (
        "lt_code_1",
        "lt_code",
        "landtype_code",
        "ltype_code",
        "code",
    )
    code = None
    for key in code_candidates:
        value = props.get(key)
        if value not in (None, ""):
            code = str(value).strip()
            if code:
                break
    if not code:
        name = _clean_text(props.get("name") or props.get("display_name"))
        code = name
    if not code:
        return None
    mapped = LANDTYPE_COLOR_MAP.get(code)
    if mapped:
        return mapped
    return _rgb_to_hex(color_from_code(code))


def color_for_veg(props: dict) -> Optional[str]:
    """Return deterministic colour for regulated vegetation categories."""
    code_candidates = (
        "rvm_cat",
        "rvm_class",
        "veg_class",
        "class_name",
        "veg_code",
        "code",
    )
    code = None
    for key in code_candidates:
        value = props.get(key)
        if value not in (None, ""):
            code = str(value).strip()
            if code:
                break
    if not code:
        name = _clean_text(props.get("name") or props.get("display_name"))
        code = name
    if not code:
        return None
    return _rgb_to_hex(color_from_code(code))


def color_for_water(props: dict) -> Optional[str]:
    """Return colour for surface water features using dataset palette."""
    # Try explicit hex colour already present
    layer_color = _clean_text(props.get("layer_color") or props.get("color"))
    if layer_color and layer_color.startswith("#") and len(layer_color) in (4, 7):
        return layer_color

    layer_id_text = _clean_text(props.get("layer_id") or props.get("dataset_id") or props.get("id"))
    if layer_id_text and layer_id_text.lower().startswith("water-"):
        try:
            numeric_id = int(layer_id_text.split("-", 1)[1])
            mapped = WATER_LAYER_COLORS.get(numeric_id)
            if mapped:
                return mapped
        except ValueError:
            pass

    status = _clean_text(
        props.get("status")
        or props.get("status_code")
        or props.get("facility_status")
        or props.get("facility_status_decode")
    )
    if status:
        mapped = BORE_STATUS_COLORS.get(status.upper())
        if mapped:
            return mapped

    code = _clean_text(
        props.get("code")
        or props.get("name")
        or props.get("display_name")
    )
    if not code:
        return None
    return _rgb_to_hex(color_from_code(code))
