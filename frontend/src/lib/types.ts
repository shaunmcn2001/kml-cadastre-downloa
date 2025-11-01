import type { Feature, FeatureCollection, Geometry } from 'geojson';

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

export interface PropertyReportExportOptions {
  includeParcels?: boolean;
  folderName?: string;
}

export interface PropertyReportExportRequest {
  report: PropertyReportResponse;
  format: 'kml' | 'kmz' | 'geojson';
  visibleLayers?: Record<string, boolean>;
  options?: PropertyReportExportOptions;
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

export type LandTypeColorMode = 'preset' | 'byProperty';

export interface LandTypeStyleOptions {
  colorMode: LandTypeColorMode;
  presetName?: string;
  propertyKey?: string;
  alpha?: number;
}

export interface LandTypeLegendEntry {
  code: string;
  name?: string;
  color_hex?: string;
  area_ha?: number;
}

export type LandTypeFeature = Feature<
  Geometry,
  {
    code: string;
    name?: string;
    area_ha?: number;
    lotplan?: string;
    landtype_color?: string;
    landtype_alpha?: number;
    color_hex?: string;
    source?: string;
    style?: {
      color?: string;
      weight?: number;
      fillColor?: string;
      fillOpacity?: number;
    };
    [key: string]: any;
  }
>;

export interface LandTypeCollectionProperties {
  styleOptions?: LandTypeStyleOptions;
  legend?: LandTypeLegendEntry[];
  warnings?: string[];
  lotplans?: string[];
  mode?: 'lotplans' | 'bbox';
  bbox?: [number, number, number, number];
}

export type LandTypeFeatureCollection = FeatureCollection<Geometry, LandTypeFeature['properties']> & {
  properties?: LandTypeCollectionProperties;
};

export type LandTypeExportFormat = 'kml' | 'kmz' | 'geojson' | 'tiff';

export interface LandTypeExportRequest {
  features: LandTypeFeatureCollection;
  format: LandTypeExportFormat;
  styleOptions: LandTypeStyleOptions;
  filenameTemplate?: string;
}

export interface LandTypeExportResponse {
  blob: Blob;
  filename: string;
  contentType: string | null;
}

export type GrazingFeatureCollection = FeatureCollection<
  Geometry,
  {
    type: string;
    name: string;
    area_ha: number;
    [key: string]: any;
  }
>;

export interface GrazingDownloadPayload {
  filename: string;
  contentType: string;
  data: string;
}

export type GrazingMethod = 'basic' | 'advanced';

export interface GrazingRingSummary {
  label: string;
  weight: number;
  areaHa: number;
  hullAreaHa?: number;
}

export interface GrazingSummary {
  pointCount: number;
  bufferAreaHa: number;
  convexAreaHa: number;
  concaveAlpha?: number;
  concaveTightness?: number;
  ringClasses?: GrazingRingSummary[];
}

export interface GrazingProcessResponse {
  method: GrazingMethod;
  buffers?: GrazingFeatureCollection | null;
  convexHull?: GrazingFeatureCollection | null;
  rings?: GrazingFeatureCollection | null;
  ringHulls?: GrazingFeatureCollection | null;
  summary: GrazingSummary;
  downloads: Record<'kml' | 'kmz' | 'shp', GrazingDownloadPayload>;
}
