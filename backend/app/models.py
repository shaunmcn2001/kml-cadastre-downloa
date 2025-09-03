from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from enum import Enum

class ParcelState(str, Enum):
    NSW = "NSW"
    QLD = "QLD"
    SA = "SA"

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

class FeatureProperties(BaseModel):
    id: str
    state: ParcelState
    name: str
    area_ha: Optional[float] = None

class Feature(BaseModel):
    type: str = "Feature"
    geometry: Dict[str, Any]
    properties: FeatureProperties

class FeatureCollection(BaseModel):
    type: str = "FeatureCollection"
    features: List[Feature]

class StyleOptions(BaseModel):
    fillOpacity: Optional[float] = 0.3
    strokeWidth: Optional[float] = 2.0
    colorByState: Optional[bool] = True

class ExportRequest(BaseModel):
    features: List[Feature]
    styleOptions: Optional[StyleOptions] = None

class ErrorResponse(BaseModel):
    error: str
    detail: Optional[str] = None
    request_id: Optional[str] = None

class HealthResponse(BaseModel):
    status: str
    timestamp: str
    version: Optional[str] = None