import { getConfig } from './config';
import type {
  ParseRequest,
  ParseResponse,
  QueryRequest,
  QueryResponse,
  ExportRequest,
  ParcelSearchRequest,
  ParcelSearchResponse,
  ApiError,
  DebugEntry,
  PropertyLayerMeta,
  PropertyReportRequest,
  PropertyReportResponse,
  LandTypeFeatureCollection,
  LandTypeExportRequest,
  LandTypeExportResponse
} from './types';

function extractFilenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const filenameMatch = /filename\*?=([^;]+)/i.exec(disposition);
  if (!filenameMatch) return null;

  const value = filenameMatch[1].trim();
  if (value.startsWith("UTF-8''")) {
    try {
      return decodeURIComponent(value.slice(7).replace(/"/g, ''));
    } catch (error) {
      console.warn('Failed to decode filename from header', error);
      return value.slice(7).replace(/"/g, '');
    }
  }

  return value.replace(/"/g, '');
}

class ApiClient {
  private debugEntries: DebugEntry[] = [];
  private debugListeners: Array<(entries: DebugEntry[]) => void> = [];

  private async makeRequest<T>(
    method: string,
    endpoint: string,
    body?: any,
    responseType: 'json' | 'blob' = 'json'
  ): Promise<T> {
    const config = getConfig();
    const url = `${config.BACKEND_URL}${endpoint}`;
    
    const debugEntry: DebugEntry = {
      timestamp: new Date(),
      method,
      url
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000); // Increased timeout for file downloads

    try {
      const startTime = Date.now();
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      // Set appropriate Accept header based on response type
      if (responseType === 'json') {
        headers['Accept'] = 'application/json';
      } else {
        headers['Accept'] = '*/*';
      }
      
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit'
      });

      debugEntry.duration = Date.now() - startTime;
      debugEntry.status = response.status;

      if (!response.ok) {
        let errorData: ApiError;
        try {
          errorData = await response.json();
        } catch {
          errorData = { 
            error: `HTTP ${response.status}`, 
            detail: response.statusText 
          };
        }
        debugEntry.error = `${errorData.error}: ${errorData.detail}`;
        throw new Error(`Backend error (${response.status}): ${errorData.detail || errorData.error}`);
      }

      let result: any;
      if (responseType === 'blob') {
        result = await response.blob();
        console.log('Received blob:', { 
          size: result.size, 
          type: result.type,
          contentType: response.headers.get('content-type'),
          contentDisposition: response.headers.get('content-disposition')
        });
      } else {
        result = await response.json();
      }

      return result as T;
    } catch (error) {
      let errorMessage: string;
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = 'Request timeout - backend took too long to respond';
        } else if (error.message.includes('Failed to fetch')) {
          errorMessage = `Network error - cannot reach backend at ${config.BACKEND_URL}. Check if the service is running and CORS is configured.`;
        } else {
          errorMessage = error.message;
        }
      } else {
        errorMessage = 'Unknown error';
      }
      
      debugEntry.error = errorMessage;
      throw new Error(errorMessage);
    } finally {
      clearTimeout(timeout);
      this.debugEntries.push(debugEntry);
      this.notifyDebugListeners();
    }
  }

  async parseInput(request: ParseRequest): Promise<ParseResponse> {
    return this.makeRequest<ParseResponse>('POST', '/api/parse', request);
  }

  async queryParcels(request: QueryRequest): Promise<QueryResponse> {
    return this.makeRequest<QueryResponse>('POST', '/api/query', request);
  }

  async searchParcels(request: ParcelSearchRequest): Promise<ParcelSearchResponse> {
    return this.makeRequest<ParcelSearchResponse>('POST', '/api/search', request);
  }

  async exportKML(request: ExportRequest): Promise<Blob> {
    return this.makeRequest<Blob>('POST', '/api/kml', request, 'blob');
  }

  async exportKMZ(request: ExportRequest): Promise<Blob> {
    return this.makeRequest<Blob>('POST', '/api/kmz', request, 'blob');
  }

  async exportGeoTIFF(request: ExportRequest): Promise<Blob> {
    return this.makeRequest<Blob>('POST', '/api/geotiff', request, 'blob');
  }

  async healthCheck(): Promise<{ status: string }> {
    return this.makeRequest<{ status: string }>('GET', '/healthz');
  }

  async listPropertyLayers(): Promise<PropertyLayerMeta[]> {
    return this.makeRequest<PropertyLayerMeta[]>('GET', '/api/property-report/layers');
  }

  async queryPropertyReport(request: PropertyReportRequest): Promise<PropertyReportResponse> {
    return this.makeRequest<PropertyReportResponse>('POST', '/api/property-report/query', request);
  }

  async downloadSmartMaps(lotPlans: string[]): Promise<{ blob: Blob; fileName: string; failures: string[] }> {
    const config = getConfig();
    const url = `${config.BACKEND_URL}/api/smartmaps/download`;

    const debugEntry: DebugEntry = {
      timestamp: new Date(),
      method: 'POST',
      url
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    try {
      const startTime = Date.now();
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/zip'
        },
        body: JSON.stringify({ lotPlans }),
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit'
      });

      debugEntry.duration = Date.now() - startTime;
      debugEntry.status = response.status;

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorData: ApiError = await response.json();
          errorMessage = `${errorData.error}: ${errorData.detail}`;
        } catch {
          errorMessage = `${errorMessage}: ${response.statusText}`;
        }
        debugEntry.error = errorMessage;
        throw new Error(`Backend error (${response.status}): ${errorMessage}`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition');
      const fileName = extractFilenameFromDisposition(disposition) || 'smartmaps-qld.zip';
      let failures: string[] = [];
      const failuresHeader = response.headers.get('x-smartmap-failures');
      if (failuresHeader) {
        try {
          failures = JSON.parse(failuresHeader);
        } catch (error) {
          console.warn('Failed to parse SmartMap failure header', error);
        }
      }

      return { blob, fileName, failures };
    } catch (error) {
      let errorMessage: string;
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = 'Request timeout - backend took too long to respond';
        } else if (error.message.includes('Failed to fetch')) {
          errorMessage = `Network error - cannot reach backend at ${config.BACKEND_URL}. Check if the service is running and CORS is configured.`;
        } else {
          errorMessage = error.message;
        }
      } else {
        errorMessage = 'Unknown error';
      }

      debugEntry.error = errorMessage;
      throw new Error(errorMessage);
    } finally {
      clearTimeout(timeout);
      this.debugEntries.push(debugEntry);
      this.notifyDebugListeners();
    }
  }

  async fetchLandTypeGeojson(params: {
    lotplans?: string[];
    bbox?: [number, number, number, number];
  }): Promise<LandTypeFeatureCollection> {
    const query = new URLSearchParams();
    if (params.lotplans && params.lotplans.length > 0) {
      query.set('lotplans', params.lotplans.join(','));
    }
    if (params.bbox) {
      query.set('bbox', params.bbox.join(','));
    }
    const suffix = query.toString();
    const endpoint = `/landtype/geojson${suffix ? `?${suffix}` : ''}`;
    return this.makeRequest<LandTypeFeatureCollection>('GET', endpoint);
  }

  async exportLandType(request: LandTypeExportRequest): Promise<LandTypeExportResponse> {
    const config = getConfig();
    const url = `${config.BACKEND_URL}/landtype/export`;

    const debugEntry: DebugEntry = {
      timestamp: new Date(),
      method: 'POST',
      url,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    try {
      const startTime = Date.now();
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': '*/*',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
      });

      debugEntry.duration = Date.now() - startTime;
      debugEntry.status = response.status;

      if (!response.ok) {
        let errorData: ApiError;
        try {
          errorData = await response.json();
        } catch {
          errorData = {
            error: `HTTP ${response.status}`,
            detail: response.statusText,
          };
        }
        debugEntry.error = `${errorData.error}: ${errorData.detail}`;
        throw new Error(`LandType export failed (${response.status}): ${errorData.detail || errorData.error}`);
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition');
      const contentType = response.headers.get('content-type');

      const fallbackFilenames: Record<string, string> = {
        kml: 'landtype-export.kml',
        kmz: 'landtype-export.kmz',
        geojson: 'landtype-export.geojson',
        tiff: 'landtype-export.tif',
      };
      const filename =
        extractFilenameFromDisposition(contentDisposition) ||
        fallbackFilenames[request.format] ||
        'landtype-export';

      return {
        blob,
        filename,
        contentType,
      };
    } catch (error) {
      let message = 'Unknown error';
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          message = 'LandType export timed out';
        } else {
          message = error.message;
        }
      }
      debugEntry.error = message;
      throw new Error(message);
    } finally {
      clearTimeout(timeout);
      this.debugEntries.push(debugEntry);
      this.notifyDebugListeners();
    }
  }

  getDebugEntries(): DebugEntry[] {
    return [...this.debugEntries];
  }

  onDebugUpdate(callback: (entries: DebugEntry[]) => void): () => void {
    this.debugListeners.push(callback);
    return () => {
      const index = this.debugListeners.indexOf(callback);
      if (index > -1) {
        this.debugListeners.splice(index, 1);
      }
    };
  }

  clearDebugEntries(): void {
    this.debugEntries = [];
    this.notifyDebugListeners();
  }

  private notifyDebugListeners(): void {
    this.debugListeners.forEach(callback => callback([...this.debugEntries]));
  }
}

export const apiClient = new ApiClient();
