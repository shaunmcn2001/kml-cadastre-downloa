from __future__ import annotations

from typing import Any, Optional

from ..landtype.colors import color_for_landtype, color_for_veg, color_for_water

_LANDTYPE_LAYER_IDS = {"landtypes", "land_types"}
_VEGETATION_LAYER_IDS = {"vegetation", "regulated_vegetation", "veg"}
_WATER_LAYER_PREFIXES = ("water-", "watercourse", "watercourses")
_WATER_LAYER_IDS = {"water_bores", "watercourses", "farm_dams", "bores"}


def _normalise_layer_id(layer_id: Optional[str]) -> str:
    return (layer_id or "").strip().lower()


def resolve_layer_color(layer_id: str, props: dict[str, Any]) -> Optional[str]:
    """
    Resolve a colour for a dataset feature based on legacy styling rules.

    Prefers specialised palettes for Land Types, vegetation, and water datasets.
    Falls back to None so calling code can apply layer-level strategies.
    """

    normalised = _normalise_layer_id(layer_id)

    if normalised in _LANDTYPE_LAYER_IDS:
        color = color_for_landtype(props)
        if color:
            return color

    if normalised in _VEGETATION_LAYER_IDS:
        color = color_for_veg(props)
        if color:
            return color

    if normalised in _WATER_LAYER_IDS or normalised.startswith(_WATER_LAYER_PREFIXES):
        color = color_for_water({**props, "layer_id": props.get("layer_id") or layer_id})
        if color:
            return color

    return None
