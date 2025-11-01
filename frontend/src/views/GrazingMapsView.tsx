import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api';
import type { GrazingFeatureCollection, GrazingProcessResponse, GrazingSummary, GrazingMethod } from '@/lib/types';
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cn } from '@/lib/utils';
import { CloudArrowUp, DownloadSimple, FileWarning, MapPin, UploadSimple } from '@phosphor-icons/react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

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
  const [method, setMethod] = useState<GrazingMethod>('basic');
  const [pointsFile, setPointsFile] = useState<File | null>(null);
  const [boundaryFile, setBoundaryFile] = useState<File | null>(null);
  const [buffers, setBuffers] = useState<GrazingFeatureCollection | null>(null);
  const [convex, setConvex] = useState<GrazingFeatureCollection | null>(null);
  const [rings, setRings] = useState<GrazingFeatureCollection | null>(null);
  const [summary, setSummary] = useState<GrazingSummary | null>(null);
  const [downloads, setDownloads] = useState<GrazingProcessResponse['downloads'] | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const handleMapRef = useCallback((instance: L.Map | null) => {
    mapRef.current = instance;
  }, []);

  const fitToResults = useCallback((collections: Array<GrazingFeatureCollection | null | undefined>) => {
    const map = mapRef.current;
    if (!map) return;

    const layers = collections
      .filter(Boolean)
      .map((collection) => {
        const layer = L.geoJSON(collection as any);
        return layer.getLayers().length > 0 ? layer : null;
      })
      .filter(Boolean) as L.GeoJSON[];

    if (!layers.length) {
      return;
    }

    const featureGroup = L.featureGroup(layers);
    const bounds = featureGroup.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [32, 32] });
    }
  }, []);

  const resetResults = useCallback(() => {
    setBuffers(null);
    setConvex(null);
    setRings(null);
    setSummary(null);
    setDownloads(null);
  }, []);

  const handleMethodChange = useCallback(
    (value: string) => {
      if (!value) return;
      setMethod(value as GrazingMethod);
      resetResults();
    },
    [resetResults],
  );

  const handlePointsSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setPointsFile(file);
    setUploadError(null);
    event.target.value = '';
  }, []);

  const handleBoundarySelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setBoundaryFile(file);
    setUploadError(null);
    event.target.value = '';
  }, []);

  const preventDefault = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  const handlePointsDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0] ?? null;
    if (file) {
      setPointsFile(file);
      setUploadError(null);
    }
  }, []);

  const handleBoundaryDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0] ?? null;
    if (file) {
      setBoundaryFile(file);
      setUploadError(null);
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!pointsFile) {
      setUploadError('Upload a trough point dataset to continue.');
      return;
    }
    if (!boundaryFile) {
      setUploadError('Upload a boundary file to clip the grazing areas.');
      return;
    }

    setIsProcessing(true);
    setUploadError(null);

    try {
      const result = await apiClient.processGrazing(pointsFile, method, boundaryFile);
      setSummary(result.summary);
      setDownloads(result.downloads);

      if (result.method === 'basic') {
        setBuffers(result.buffers ?? null);
        setConvex(result.convexHull ?? null);
        setRings(null);
      } else {
        setRings(result.rings ?? null);
        setBuffers(null);
        setConvex(null);
      }

      fitToResults([result.buffers ?? null, result.convexHull ?? null, result.rings ?? null]);
      toast.success(result.method === 'basic' ? 'Grazing buffers generated successfully' : 'Advanced grazing rings generated');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process grazing maps';
      setUploadError(message);
      toast.error(message);
      resetResults();
    } finally {
      setIsProcessing(false);
    }
  }, [boundaryFile, fitToResults, method, pointsFile, resetResults]);

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

  const ringLayerStyle = useMemo(
    () => ({
      color: '#be185d',
      weight: 2,
      fillColor: '#f472b6',
      fillOpacity: 0.3,
    }),
    [],
  );

  const hasBasicResults = Boolean(method === 'basic' && buffers && convex && summary);
  const hasAdvancedResults = Boolean(method === 'advanced' && rings && summary);
  const hasResults = hasBasicResults || hasAdvancedResults;

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
            {rings && (
              <GeoJSON key="rings" data={rings as any} style={() => ringLayerStyle} />
            )}
          </MapContainer>

          {!hasResults && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/75 backdrop-blur-sm">
              <MapPin className="w-12 h-12 text-muted-foreground" />
              <div className="text-center text-muted-foreground">
                <p className="text-sm font-medium">Upload trough points and a boundary to begin</p>
                <p className="text-xs">Supports KML, KMZ, or zipped SHP datasets</p>
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
                Upload trough points and a boundary to generate grazing zones. Choose between the basic 3 km buffer workflow or advanced graded rings around water points.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Method</span>
                <ToggleGroup type="single" value={method} onValueChange={handleMethodChange} className="bg-muted/40 rounded-md p-1">
                  <ToggleGroupItem value="basic" className="text-xs">Basic</ToggleGroupItem>
                  <ToggleGroupItem value="advanced" className="text-xs">Advanced</ToggleGroupItem>
                </ToggleGroup>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {method === 'basic'
                  ? 'Basic: buffers every trough by 3 km, applies a smoothed convex hull, and clips to the supplied boundary.'
                  : 'Advanced: builds weighted rings at 0.5, 1.5, and 3 km from troughs, clipped to the supplied boundary.'}
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div
                className={cn(
                  'border border-dashed rounded-lg p-6 text-center transition-colors',
                  'bg-muted/40 hover:bg-muted/60 cursor-pointer',
                  isProcessing && 'opacity-70 pointer-events-none',
                )}
                onDrop={handlePointsDrop}
                onDragOver={preventDefault}
                onDragEnter={preventDefault}
              >
                <input
                  id="grazing-points-upload"
                  type="file"
                  accept=".kml,.kmz,.zip,.shp"
                  className="hidden"
                  onChange={handlePointsSelect}
                />
                <label htmlFor="grazing-points-upload" className="flex flex-col items-center gap-2 cursor-pointer">
                  <UploadSimple className="w-8 h-8 text-primary" />
                  <span className="text-sm font-medium text-foreground">Drop trough points or click to upload</span>
                  <span className="text-xs text-muted-foreground">Accepted formats: KML, KMZ, or zipped Shapefile (points only)</span>
                  <span className="text-[11px] text-muted-foreground/80">Altitude values are ignored automatically.</span>
                </label>
                {pointsFile && (
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Selected: <span className="font-medium text-foreground">{pointsFile.name}</span>
                  </p>
                )}
              </div>

              <div
                className={cn(
                  'border border-dashed rounded-lg p-6 text-center transition-colors',
                  'bg-muted/30 hover:bg-muted/50 cursor-pointer',
                  isProcessing && 'opacity-70 pointer-events-none',
                )}
                onDrop={handleBoundaryDrop}
                onDragOver={preventDefault}
                onDragEnter={preventDefault}
              >
                <input
                  id="grazing-boundary-upload"
                  type="file"
                  accept=".kml,.kmz,.zip,.shp"
                  className="hidden"
                  onChange={handleBoundarySelect}
                />
                <label htmlFor="grazing-boundary-upload" className="flex flex-col items-center gap-2 cursor-pointer">
                  <CloudArrowUp className="w-8 h-8 text-primary" />
                  <span className="text-sm font-medium text-foreground">Drop boundary or click to upload</span>
                  <span className="text-xs text-muted-foreground">Accepted formats: KML, KMZ, or zipped Shapefile (polygons)</span>
                  <span className="text-[11px] text-muted-foreground/80">The boundary clips all outputs so buffers stay inside your paddock.</span>
                </label>
                {boundaryFile && (
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Selected: <span className="font-medium text-foreground">{boundaryFile.name}</span>
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-[11px] text-muted-foreground">
                  Both files must be supplied before generating zones.
                </div>
                <Button
                  onClick={handleGenerate}
                  disabled={!pointsFile || !boundaryFile || isProcessing}
                  className="sm:w-auto"
                >
                  {isProcessing ? 'Processing…' : `Generate ${method === 'basic' ? 'Basic Zones' : 'Advanced Rings'}`}
                </Button>
              </div>

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
                    <span>Total area: <strong>{summary.bufferAreaHa.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha</strong></span>
                  </div>
                  {summary.ringClasses && summary.ringClasses.length > 0 ? (
                    <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Ring Classes</div>
                      <div className="space-y-1">
                        {summary.ringClasses.map((ring) => (
                          <div key={ring.label} className="flex items-center justify-between">
                            <span className="font-medium">{ring.label} km</span>
                            <span className="text-muted-foreground">Weight {ring.weight.toFixed(2)} • {ring.areaHa.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
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
                  )}
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
