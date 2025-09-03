export type ParcelState = 'NSW' | 'QLD' | 'SA';

export interface ParsedParcel {
  id: string;
  state: ParcelState;
  raw: string;
  lot?: string;
  section?: string;
  plan?: string;
  volume?: string;
  folio?: string;
}

export interface ParseRequest {
  state: ParcelState;
  rawText: string;
}

export interface ParseResponse {
  valid: ParsedParcel[];
  malformed: Array<{
    raw: string;
    error: string;
  }>;
}

export interface QueryRequest {
  states: ParcelState[];
  ids: string[];
  aoi?: [number, number, number, number]; // bbox
  options?: {
    pageSize?: number;
    simplifyTol?: number;
  };
}

export interface ParcelFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    id: string;
    state: ParcelState;
    name: string;
    area_ha?: number;
    [key: string]: any;
  };
}

export interface QueryResponse {
  type: 'FeatureCollection';
  features: ParcelFeature[];
}

export interface ExportRequest {
  features: ParcelFeature[];
  styleOptions?: {
    fillOpacity?: number;
    strokeWidth?: number;
    colorByState?: boolean;
    googleEarthOptimized?: boolean;
    version?: string;
  };
}

export interface ApiError {
  error: string;
  detail?: string;
  request_id?: string;
}

export interface DebugEntry {
  timestamp: Date;
  method: string;
  url: string;
  duration?: number;
  status?: number;
  error?: string;
}