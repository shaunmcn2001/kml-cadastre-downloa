import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api';
import type { GrazingFeatureCollection, GrazingProcessResponse, GrazingSummary } from '@/lib/types';
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cn } from '@/lib/utils';
import { CloudArrowUp, DownloadSimple, FileWarning, MapPin, UploadSimple } from '@phosphor-icons/react';

type DownloadKey = keyof GrazingProcessResponse['downloads'];

const basemapUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const basemapAttribution = '© OpenStreetMap contributors';

interface DownloadItem {
  key: DownloadKey;
  label: string;
  description: string;
}

const downloadsMeta: DownloadItem[] = [
  { key: 'kmz', label: 'Download KMZ', description: 'Google Earth compatible (compressed)' },
  { key: 'kml', label: 'Download KML', description: 'Standard KML polygon output' },
  { key: 'shp', label: 'Download Shapefile', description: 'Zipped ESRI Shapefile with areas' },
];

export function GrazingMapsView() {
  const [buffers, setBuffers] = useState<GrazingFeatureCollection | null>(null);
  const [convex, setConvex] = useState<GrazingFeatureCollection | null>(null);
  const [summary, setSummary] = useState<GrazingSummary | null>(null);
  const [downloads, setDownloads] = useState<GrazingProcessResponse['downloads'] | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const handleMapRef = useCallback((instance: L.Map | null) => {
    mapRef.current = instance;
  }, []);

  const fitToResults = useCallback(
    (data: GrazingFeatureCollection | null, other?: GrazingFeatureCollection | null) => {
      const map = mapRef.current;
      if (!map) return;
      const layers: L.GeoJSON[] = [];

      const addLayer = (collection: GrazingFeatureCollection | null) => {
        if (!collection) return;
        const layer = L.geoJSON(collection as any);
        if (layer.getLayers().length > 0) {
          layers.push(layer);
        }
      };

      addLayer(data);
      addLayer(other ?? null);

      if (!layers.length) return;

      const featureGroup = L.featureGroup(layers);
      const bounds = featureGroup.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [32, 32] });
      }
    },
    [],
  );

  const processFile = useCallback(
    async (file: File) => {
      setIsProcessing(true);
      setUploadError(null);

      try {
        const result = await apiClient.processGrazing(file);
        setBuffers(result.buffers);
        setConvex(result.convexHull);
        setSummary(result.summary);
        setDownloads(result.downloads);
        fitToResults(result.buffers, result.convexHull);
        toast.success('Grazing buffers generated successfully');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to process grazing maps';
        setUploadError(message);
        toast.error(message);
        setBuffers(null);
        setConvex(null);
        setDownloads(null);
        setSummary(null);
      } finally {
        setIsProcessing(false);
      }
    },
    [fitToResults],
  );

  const handleFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        void processFile(file);
      }
    },
    [processFile],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const file = event.dataTransfer.files?.[0];
      if (file) {
        void processFile(file);
      }
    },
    [processFile],
  );

  const preventDefault = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  const handleDownload = useCallback(
    (key: DownloadKey) => {
      if (!downloads) return;
      const payload = downloads[key];
      if (!payload) return;

      const byteString = atob(payload.data);
      const buffer = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i += 1) {
        buffer[i] = byteString.charCodeAt(i);
      }

      const blob = new Blob([buffer], { type: payload.contentType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = payload.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    },
    [downloads],
  );

  const bufferLayerStyle = useMemo(
    () => ({
      color: '#2563eb',
      weight: 2,
      fillColor: '#60a5fa',
      fillOpacity: 0.35,
    }),
    [],
  );

  const convexLayerStyle = useMemo(
    () => ({
      color: '#0f766e',
      weight: 2,
      fillColor: '#14b8a6',
      fillOpacity: 0.25,
    }),
    [],
  );

  const hasResults = Boolean(buffers && convex && summary);

  return (
    <div className="flex-1 overflow-hidden">
      <div className="h-full grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="relative bg-muted/10 border-r border-border">
          <MapContainer
            center={[-23.7, 134.5]}
            zoom={5}
            className="h-full w-full"
            zoomControl
            ref={handleMapRef}
          >
            <TileLayer url={basemapUrl} attribution={basemapAttribution} />
            {buffers && (
              <GeoJSON key="buffers" data={buffers as any} style={() => bufferLayerStyle} />
            )}
            {convex && (
              <GeoJSON key="convex" data={convex as any} style={() => convexLayerStyle} />
            )}
          </MapContainer>

          {!hasResults && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/75 backdrop-blur-sm">
              <MapPin className="w-12 h-12 text-muted-foreground" />
              <div className="text-center text-muted-foreground">
                <p className="text-sm font-medium">Upload grazing points to begin</p>
                <p className="text-xs">Supports KML, KMZ, or zipped SHP point datasets</p>
              </div>
            </div>
          )}
        </div>

        <div className="overflow-y-auto bg-card">
          <Card className="shadow-none border-0 rounded-none h-full">
            <CardHeader className="space-y-2">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <CloudArrowUp className="w-5 h-5 text-primary" />
                Grazing Map Builder
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Upload a point dataset to generate 3 km grazing buffers and a smoothed convex hull. Both layers
                include area calculations for reporting.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div
                className={cn(
                  'border border-dashed rounded-lg p-6 text-center transition-colors',
                  'bg-muted/40 hover:bg-muted/60 cursor-pointer',
                  isProcessing && 'opacity-70 pointer-events-none',
                )}
                onDrop={handleDrop}
                onDragOver={preventDefault}
                onDragEnter={preventDefault}
              >
                <input
                  id="grazing-upload"
                  type="file"
                  accept=".kml,.kmz,.zip,.shp"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <label htmlFor="grazing-upload" className="flex flex-col items-center gap-2 cursor-pointer">
                  <UploadSimple className="w-8 h-8 text-primary" />
                  <span className="text-sm font-medium text-foreground">Drop file or click to upload</span>
                  <span className="text-xs text-muted-foreground">
                    Accepted formats: KML, KMZ, or zipped Shapefile (points only)
                  </span>
                  <span className="text-[11px] text-muted-foreground/80">Buffers use a 3 km radius; hull smoothing 500 m.</span>
                </label>
              </div>

              {isProcessing && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  Processing uploaded points…
                </div>
              )}

              {uploadError && (
                <Alert variant="destructive">
                  <FileWarning className="w-4 h-4" />
                  <AlertDescription className="text-xs">{uploadError}</AlertDescription>
                </Alert>
              )}

              {summary && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="px-2 py-0.5">
                      {summary.pointCount} point{summary.pointCount === 1 ? '' : 's'}
                    </Badge>
                    <span>Total buffers area: <strong>{summary.bufferAreaHa.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha</strong></span>
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">3 km Buffers</span>
                      <span>{summary.bufferAreaHa.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Smoothed Convex Hull</span>
                      <span>{summary.convexAreaHa.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha</span>
                    </div>
                  </div>
                </div>
              )}

              <Separator />

              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-[0.18em]">
                  Export Options
                </h3>
                <div className="space-y-2">
                  {downloadsMeta.map((item) => (
                    <Button
                      key={item.key}
                      onClick={() => handleDownload(item.key)}
                      disabled={!downloads || isProcessing}
                      variant="outline"
                      size="sm"
                      className="w-full justify-between text-xs"
                    >
                      <span className="flex items-center gap-2">
                        <DownloadSimple className="w-4 h-4" />
                        {item.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{item.description}</span>
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

GrazingMapsView.displayName = 'GrazingMapsView';
