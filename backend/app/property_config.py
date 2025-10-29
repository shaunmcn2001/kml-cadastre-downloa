from dataclasses import dataclass
from typing import Dict, List, Optional


@dataclass(frozen=True)
class PropertyLayer:
    """Configuration describing a QLD dataset that can be queried for property reports."""

    id: str
    label: str
    service_url: str
    layer_id: int
    geometry_type: str  # polygon | polyline | point
    description: Optional[str] = None
    out_fields: str = "*"
    where: Optional[str] = None
    name_field: Optional[str] = None
    code_field: Optional[str] = None
    color: Optional[str] = None
    color_strategy: Optional[str] = None  # static | hash_code | lookup
    color_map: Optional[Dict[str, str]] = None
    group: Optional[str] = None

    def metadata(self) -> dict:
        """Return a serialisable metadata payload for clients."""
        return {
            "id": self.id,
            "label": self.label,
            "description": self.description,
            "geometryType": self.geometry_type,
            "color": self.color,
            "colorStrategy": self.color_strategy,
            "colorMap": self.color_map,
            "group": self.group,
        }


# Deterministic colour maps mirroring the original LandType tooling
BORE_STATUS_COLORS: Dict[str, str] = {
    "EX": "#22c55e",
    "AU": "#2563eb",
    "AD": "#ef4444",
    "IN": "#f59e0b",
}

WATER_LAYER_COLORS: Dict[int, str] = {
    20: "#0ea5e9",
    21: "#38bdf8",
    22: "#3b82f6",
    23: "#1d4ed8",
    24: "#0ea5e9",
    25: "#22d3ee",
    26: "#0891b2",
    27: "#2563eb",
    28: "#1e40af",
    30: "#0ea5e9",
    31: "#0284c7",
    33: "#14b8a6",
    34: "#0f766e",
    35: "#0d9488",
    37: "#06b6d4",
}

WATER_LAYER_TITLES: Dict[int, str] = {
    20: "Farm Dams",
    21: "Pools or Rockholes",
    22: "Waterholes",
    23: "Waterfalls",
    24: "Coastline",
    25: "Flats or Swamps",
    26: "Pondage Areas",
    27: "Lakes",
    28: "Reservoirs",
    30: "Canal Lines",
    31: "Canal Areas",
    33: "Watercourse Lines",
    34: "Watercourse Areas",
    35: "Water Area Edges",
    37: "Watercourse Stream Orders",
}

WATER_LAYER_GEOMETRY: Dict[int, str] = {
    20: "point",
    21: "point",
    22: "point",
    23: "point",
    24: "polyline",
    25: "polygon",
    26: "polygon",
    27: "polygon",
    28: "polygon",
    30: "polyline",
    31: "polygon",
    33: "polyline",
    34: "polygon",
    35: "polyline",
    37: "polyline",
}


# Layer catalogue – add/remove entries here to expose more datasets in the API.
PROPERTY_REPORT_LAYERS: List[PropertyLayer] = [
    PropertyLayer(
        id="landtypes",
        label="Land Types",
        description="Queensland Land Types classification (Environment/LandTypes)",
        service_url="https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Environment/LandTypes/MapServer",
        layer_id=1,
        geometry_type="polygon",
        name_field="lt_name_1",
        code_field="lt_code_1",
        color="#1d4ed8",
        color_strategy="hash_code",
        group="Polygons",
    ),
    PropertyLayer(
        id="vegetation",
        label="Regulated Vegetation",
        description="Vegetation Management mapping (Biota/VegetationManagement layer 109)",
        service_url="https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Biota/VegetationManagement/MapServer",
        layer_id=109,
        geometry_type="polygon",
        name_field="rvm_cat",
        code_field="rvm_cat",
        color="#16a34a",
        color_strategy="hash_code",
        group="Polygons",
    ),
    PropertyLayer(
        id="bores",
        label="Registered Water Bores",
        description="Registered water bores (GroundAndSurfaceWaterMonitoring layer 1)",
        service_url="https://spatial-gis.information.qld.gov.au/arcgis/rest/services/InlandWaters/GroundAndSurfaceWaterMonitoring/MapServer",
        layer_id=1,
        geometry_type="point",
        name_field="facility_status_decode",
        code_field="rn_char",
        color="#f97316",
        color_strategy="lookup",
        color_map=BORE_STATUS_COLORS,
        group="Points",
    ),
    PropertyLayer(
        id="easements",
        label="Easements",
        description="Cadastral easement parcels (LandParcelPropertyFramework layer 9)",
        service_url="https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer",
        layer_id=9,
        geometry_type="polygon",
        name_field="parcel_typ",
        code_field="lotplan",
        color="#a855f7",
        color_strategy="hash_code",
        group="Polygons",
    ),
]

# Add individual water datasets mirroring LandType surface water layers
for layer_id, color in WATER_LAYER_COLORS.items():
    label = WATER_LAYER_TITLES.get(layer_id, f"Water Layer {layer_id}")
    geom_type = WATER_LAYER_GEOMETRY.get(layer_id, "polygon")
    PROPERTY_REPORT_LAYERS.append(
        PropertyLayer(
            id=f"water-{layer_id}",
            label=label,
            description="Watercourses & water bodies",
            service_url="https://spatial-gis.information.qld.gov.au/arcgis/rest/services/InlandWaters/WaterCoursesAndBodies/MapServer",
            layer_id=layer_id,
            geometry_type=geom_type,
            color=color,
            color_strategy="static",
            group="Water",
        )
    )

PROPERTY_LAYER_MAP = {layer.id: layer for layer in PROPERTY_REPORT_LAYERS}
