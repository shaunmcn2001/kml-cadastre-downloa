from dataclasses import dataclass, asdict
from typing import List, Optional


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

    def metadata(self) -> dict:
        """Return a serialisable metadata payload for clients."""
        return {
            "id": self.id,
            "label": self.label,
            "description": self.description,
            "geometryType": self.geometry_type,
            "color": self.color,
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
    ),
    PropertyLayer(
        id="watercourses",
        label="Watercourses & Water Bodies",
        description="Watercourses areas (InlandWaters/WaterCoursesAndBodies layer 34)",
        service_url="https://spatial-gis.information.qld.gov.au/arcgis/rest/services/InlandWaters/WaterCoursesAndBodies/MapServer",
        layer_id=34,
        geometry_type="polygon",
        color="#0ea5e9",
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
    ),
]


PROPERTY_LAYER_MAP = {layer.id: layer for layer in PROPERTY_REPORT_LAYERS}
