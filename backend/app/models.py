from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, field_validator, ConfigDict
from enum import Enum

class ParcelState(str, Enum):
    NSW = "NSW"
    QLD = "QLD"
    SA = "SA"
    VIC = "VIC"

class ParsedParcel(BaseModel):
    id: str
    state: ParcelState
    raw: str
    lot: Optional[str] = None
    section: Optional[str] = None
    plan: Optional[str] = None
    volume: Optional[str] = None
    folio: Optional[str] = None

class MalformedEntry(BaseModel):
    raw: str
    error: str

class ParseRequest(BaseModel):
    state: ParcelState
    rawText: str

class ParseResponse(BaseModel):
    valid: List[ParsedParcel]
    malformed: List[MalformedEntry]

class QueryOptions(BaseModel):
    pageSize: Optional[int] = 1000
    simplifyTol: Optional[float] = 0.0001

class QueryRequest(BaseModel):
    states: List[ParcelState]
    ids: List[str]
    aoi: Optional[List[float]] = None  # bbox [minx, miny, maxx, maxy]
    options: Optional[QueryOptions] = None


class SearchRequest(BaseModel):
    state: ParcelState
    term: str = Field(..., min_length=2, max_length=100)
    page: int = Field(1, ge=1)
    pageSize: int = Field(10, ge=1, le=50)

    @field_validator("term")
    @classmethod
    def normalize_term(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) < 2:
            raise ValueError("term must contain at least two characters")
        return normalized


class SearchResult(BaseModel):
    id: str
    state: ParcelState
    label: str
    address: Optional[str] = None
    lot: Optional[str] = None
    plan: Optional[str] = None
    locality: Optional[str] = None

class FeatureProperties(BaseModel):
    id: str
    state: ParcelState
    name: str
    area_ha: Optional[float] = None

    model_config = ConfigDict(extra="allow")

class Feature(BaseModel):
    type: str = "Feature"
    geometry: Dict[str, Any]
    properties: FeatureProperties

class FeatureCollection(BaseModel):
    type: str = "FeatureCollection"
    features: List[Feature]

class StyleOptions(BaseModel):
    fillOpacity: Optional[float] = 0.4
    strokeWidth: Optional[float] = 3.0
    colorByState: Optional[bool] = True
    folderName: Optional[str] = None
    fillColor: Optional[str] = None
    strokeColor: Optional[str] = None
    mergeByName: Optional[bool] = False

    @field_validator("fillOpacity")
    @classmethod
    def validate_fill_opacity(cls, value: Optional[float]) -> Optional[float]:
        if value is None:
            return value
        if not (0.0 <= value <= 1.0):
            raise ValueError("fillOpacity must be between 0.0 and 1.0")
        return value

    @field_validator("strokeWidth")
    @classmethod
    def validate_stroke_width(cls, value: Optional[float]) -> Optional[float]:
        if value is None:
            return value
        if value < 0:
            raise ValueError("strokeWidth must be non-negative")
        return value

    @field_validator("fillColor", "strokeColor")
    @classmethod
    def validate_hex_color(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        hex_value = value.strip()
        if not hex_value:
            return None
        if not hex_value.startswith('#') or len(hex_value) != 7:
            raise ValueError("Color values must be provided in #RRGGBB format")
        try:
            int(hex_value[1:], 16)
        except ValueError:
            raise ValueError("Color values must be valid hexadecimal digits") from None
        return hex_value.upper()

class ExportRequest(BaseModel):
    features: List[Feature]
    styleOptions: Optional[StyleOptions] = None
    fileName: Optional[str] = None

class PropertyLayerInfo(BaseModel):
    id: str
    label: str
    description: Optional[str] = None
    geometryType: str
    color: Optional[str] = None

class PropertyReportLayer(BaseModel):
    id: str
    label: str
    geometryType: str
    featureCount: int
    color: Optional[str] = None
    featureCollection: Dict[str, Any]
    colorStrategy: Optional[str] = None
    colorMap: Optional[Dict[str, str]] = None
    group: Optional[str] = None

    model_config = ConfigDict(extra="allow")

class PropertyReportRequest(BaseModel):
    lotPlans: List[str]
    layers: Optional[List[str]] = None

class PropertyReportResponse(BaseModel):
    lotPlans: List[str]
    parcelFeatures: Dict[str, Any]
    layers: List[PropertyReportLayer]

class ErrorResponse(BaseModel):
    error: str
    detail: Optional[str] = None
    request_id: Optional[str] = None

class HealthResponse(BaseModel):
    status: str
    timestamp: str
    version: Optional[str] = None
