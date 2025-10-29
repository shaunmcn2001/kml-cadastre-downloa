export type ParcelState = 'NSW' | 'QLD' | 'SA' | 'VIC';

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

export interface PropertyLayerMeta {
  id: string;
  label: string;
  description?: string;
  geometryType: string;
  color?: string;
   colorStrategy?: string;
   colorMap?: Record<string, string>;
   group?: string;
}

export interface PropertyReportLayerResult {
  id: string;
  label: string;
  geometryType: string;
  featureCount: number;
  color?: string;
  colorStrategy?: string;
  colorMap?: Record<string, string>;
  group?: string;
  featureCollection: {
    type: 'FeatureCollection';
    features: ParcelFeature[];
  };
}

export interface PropertyReportResponse {
  lotPlans: string[];
  parcelFeatures: QueryResponse;
  layers: PropertyReportLayerResult[];
}

export interface ParcelSearchRequest {
  state: ParcelState;
  term: string;
  page?: number;
  pageSize?: number;
}

export interface ParcelSearchResult {
  id: string;
  state: ParcelState;
  label: string;
  address?: string;
  lot?: string;
  plan?: string;
  locality?: string;
}

export type ParcelSearchResponse = ParcelSearchResult[];

export interface ExportRequest {
  features: ParcelFeature[];
  fileName?: string;
  styleOptions?: {
    fillOpacity?: number;
    strokeWidth?: number;
    colorByState?: boolean;
    googleEarthOptimized?: boolean;
    version?: string;
    folderName?: string;
    fillColor?: string;
    strokeColor?: string;
    mergeByName?: boolean;
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
