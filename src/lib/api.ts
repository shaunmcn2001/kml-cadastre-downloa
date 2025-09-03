import { getConfig } from './config';
import type { 
  ParseRequest, 
  ParseResponse, 
  QueryRequest, 
  QueryResponse, 
  ExportRequest,
  ApiError,
  DebugEntry 
} from './types';

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
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const startTime = Date.now();
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': responseType === 'json' ? 'application/json' : '*/*'
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
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
        debugEntry.error = errorData.error;
        throw new Error(errorData.detail || errorData.error);
      }

      const result = responseType === 'blob' 
        ? await response.blob()
        : await response.json();

      return result as T;
    } catch (error) {
      debugEntry.error = error instanceof Error ? error.message : 'Unknown error';
      throw error;
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