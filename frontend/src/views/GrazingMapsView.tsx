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
import { CloudArrowUp, DownloadSimple, FileWarning, MapPin, TextAa, UploadSimple } from '@phosphor-icons/react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatFolderName } from '@/lib/formatters';

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
  { key: 'shp', label: 'Download Shapefile', description: 'Zipped ESRI Shapefiles with areas' },
];

const DEFAULT_BASIC_COLOR = '#5EC68F';
const DEFAULT_RING_COLORS = ['#5EC68F', '#4FA679', '#FCEE9C'];
const DEFAULT_CONCAVE_ALPHA = 0.0005;
const MIN_CONCAVE_ALPHA = 0.000001;
const MAX_CONCAVE_ALPHA = 0.05;
const ADVANCED_RING_BREAKS = [0.5, 1.5, 3.0];
const MAP_FILL_OPACITY = 0.4;
const MAP_OUTLINE_COLOR = '#000000';
const MAP_OUTLINE_WIDTH = 4;

const HEX_VALUE_PATTERN = /^[0-9A-F]{6}$/;

function normalizeHex(value: string | undefined | null, fallback: string): string {
  if (!value) {
    return fallback.toUpperCase();
  }
  const trimmed = value.trim().toUpperCase();
  const candidate = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (HEX_VALUE_PATTERN.test(candidate)) {
    return `#${candidate}`;
  }
  return fallback.toUpperCase();
}

export function GrazingMapsView() {
  const [method, setMethod] = useState<GrazingMethod>('basic');
  const [pointsFile, setPointsFile] = useState<File | null>(null);
  const [boundaryFile, setBoundaryFile] = useState<File | null>(null);
  const [folderName, setFolderName] = useState('');
  const [basicColor, setBasicColor] = useState<string>(DEFAULT_BASIC_COLOR);
  const [ringColors, setRingColors] = useState<string[]>(() => [...DEFAULT_RING_COLORS]);
  const [basicHexInput, setBasicHexInput] = useState<string>(DEFAULT_BASIC_COLOR);
  const [ringHexInputs, setRingHexInputs] = useState<string[]>(() => [...DEFAULT_RING_COLORS]);
  const [basicAlpha, setBasicAlpha] = useState<string>(DEFAULT_CONCAVE_ALPHA.toString());
  const [buffers, setBuffers] = useState<GrazingFeatureCollection | null>(null);
  const [convex, setConvex] = useState<GrazingFeatureCollection | null>(null);
  const [rings, setRings] = useState<GrazingFeatureCollection | null>(null);
  const [ringHulls, setRingHulls] = useState<GrazingFeatureCollection | null>(null);
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
    setRingHulls(null);
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

  const basicColorIsDefault = useMemo(() => basicColor === DEFAULT_BASIC_COLOR, [basicColor]);

  const ringColorsAreDefault = useMemo(
    () => ringColors.every((color, index) => color === DEFAULT_RING_COLORS[Math.min(index, DEFAULT_RING_COLORS.length - 1)]),
    [ringColors],
  );

  const ringColorRows = useMemo(
    () =>
      ringHexInputs.map((hex, index) => {
        const start = index === 0 ? 0 : ADVANCED_RING_BREAKS[index - 1] ?? ADVANCED_RING_BREAKS[0];
        const end = ADVANCED_RING_BREAKS[index] ?? ADVANCED_RING_BREAKS[ADVANCED_RING_BREAKS.length - 1];
        const label = `${start}\u2013${end} km`;
        const fallback = DEFAULT_RING_COLORS[Math.min(index, DEFAULT_RING_COLORS.length - 1)];
        return {
          index,
          label,
          color: ringColors[index] ?? fallback,
          hex,
        };
      }),
    [ringColors, ringHexInputs],
  );

  const handleBasicColorPickerChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const normalized = normalizeHex(event.target.value, DEFAULT_BASIC_COLOR);
    setBasicColor(normalized);
    setBasicHexInput(normalized);
  }, []);

  const handleBasicHexInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setBasicHexInput(event.target.value.toUpperCase());
  }, []);

  const handleBasicHexInputBlur = useCallback(() => {
    const normalized = normalizeHex(basicHexInput, DEFAULT_BASIC_COLOR);
    setBasicHexInput(normalized);
    setBasicColor(normalized);
  }, [basicHexInput]);

  const handleBasicColorReset = useCallback(() => {
    setBasicColor(DEFAULT_BASIC_COLOR);
    setBasicHexInput(DEFAULT_BASIC_COLOR);
  }, []);

  const handleBasicAlphaChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setBasicAlpha(event.target.value);
  }, []);

  const handleBasicAlphaBlur = useCallback(() => {
    const numeric = Number.parseFloat(basicAlpha);
    if (!Number.isFinite(numeric)) {
      setBasicAlpha(DEFAULT_CONCAVE_ALPHA.toString());
      return;
    }
    const clamped = Math.min(MAX_CONCAVE_ALPHA, Math.max(MIN_CONCAVE_ALPHA, numeric));
    setBasicAlpha(clamped.toString());
  }, [basicAlpha]);

  const handleRingColorPickerChange = useCallback((index: number, value: string) => {
    const fallback = DEFAULT_RING_COLORS[Math.min(index, DEFAULT_RING_COLORS.length - 1)];
    const normalized = normalizeHex(value, fallback);
    setRingColors((prev) => {
      const next = [...prev];
      next[index] = normalized;
      return next;
    });
    setRingHexInputs((prev) => {
      const next = [...prev];
      next[index] = normalized;
      return next;
    });
  }, []);

  const handleRingHexInputChange = useCallback((index: number, value: string) => {
    setRingHexInputs((prev) => {
      const next = [...prev];
      next[index] = value.toUpperCase();
      return next;
    });
  }, []);

  const handleRingHexInputBlur = useCallback(
    (index: number) => {
      const fallback = DEFAULT_RING_COLORS[Math.min(index, DEFAULT_RING_COLORS.length - 1)];
      const normalized = normalizeHex(ringHexInputs[index], fallback);
      setRingHexInputs((prev) => {
        const next = [...prev];
        next[index] = normalized;
        return next;
      });
      setRingColors((prev) => {
        const next = [...prev];
        next[index] = normalized;
        return next;
      });
    },
    [ringHexInputs],
  );

  const handleRingColorReset = useCallback(() => {
    const defaults = [...DEFAULT_RING_COLORS];
    setRingColors(defaults);
    setRingHexInputs(defaults);
  }, []);

  const featureStyle = useCallback(
    (feature?: any): L.PathOptions => {
      const props = feature?.properties ?? {};
      const isHull = props?.type === 'ring_hull';
      const fillColorProp = typeof props?.fill_color === 'string' ? props.fill_color : undefined;
      const strokeColorProp = typeof props?.stroke_color === 'string' ? props.stroke_color : MAP_OUTLINE_COLOR;
      const strokeWidthProp =
        typeof props?.stroke_width === 'number' && Number.isFinite(props.stroke_width) ? props.stroke_width : MAP_OUTLINE_WIDTH;

      return {
        color: strokeColorProp,
        weight: strokeWidthProp,
        opacity: 1,
        fillColor: fillColorProp ?? strokeColorProp,
        fillOpacity: fillColorProp ? MAP_FILL_OPACITY : 0,
        dashArray: isHull ? '6 4' : undefined,
      };
    },
    [],
  );

  const ringSummaryWithColors = useMemo(() => {
    if (!summary?.ringClasses) {
      return [];
    }
    const colorByLabel = new Map<string, string>();
    rings?.features.forEach((feature) => {
      const props = feature.properties as Record<string, any> | undefined;
      const label = typeof props?.distance_class === 'string' ? props.distance_class : typeof props?.name === 'string' ? props.name : null;
      const fillColor = typeof props?.fill_color === 'string' ? props.fill_color : null;
      if (label && fillColor) {
        colorByLabel.set(label, fillColor);
      }
    });
    return summary.ringClasses.map((ring) => ({
      ...ring,
      color: colorByLabel.get(ring.label) ?? null,
    }));
  }, [rings, summary]);

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
      const sanitizedBasicColor = normalizeHex(basicHexInput, DEFAULT_BASIC_COLOR);
      if (sanitizedBasicColor !== basicColor) {
        setBasicColor(sanitizedBasicColor);
      }
      if (sanitizedBasicColor !== basicHexInput) {
        setBasicHexInput(sanitizedBasicColor);
      }

      const sanitizedRingColors = ringHexInputs.map((value, index) =>
        normalizeHex(value, DEFAULT_RING_COLORS[Math.min(index, DEFAULT_RING_COLORS.length - 1)]),
      );
      if (sanitizedRingColors.some((color, index) => color !== ringHexInputs[index])) {
        setRingHexInputs(sanitizedRingColors);
      }
      if (sanitizedRingColors.some((color, index) => color !== ringColors[index])) {
        setRingColors(sanitizedRingColors);
      }

      let sanitizedAlpha = DEFAULT_CONCAVE_ALPHA;
      if (method === 'basic') {
        const parsedAlpha = Number.parseFloat(basicAlpha);
        if (Number.isFinite(parsedAlpha)) {
          sanitizedAlpha = Math.min(MAX_CONCAVE_ALPHA, Math.max(MIN_CONCAVE_ALPHA, parsedAlpha));
        }
        if (sanitizedAlpha.toString() !== basicAlpha) {
          setBasicAlpha(sanitizedAlpha.toString());
        }
      }

      const trimmedFolder = folderName.trim();

      const result = await apiClient.processGrazing(pointsFile, method, {
        boundary: boundaryFile,
        folderName: trimmedFolder ? trimmedFolder : undefined,
        colorBasic: sanitizedBasicColor,
        colorRings: sanitizedRingColors,
        alphaBasic: method === 'basic' ? sanitizedAlpha : undefined,
      });
      setSummary(result.summary);
      setDownloads(result.downloads);

      if (result.method === 'basic') {
        setBuffers(result.buffers ?? null);
        setConvex(result.convexHull ?? null);
        setRings(null);
      } else {
        setRings(result.rings ?? null);
        setRingHulls(result.ringHulls ?? null);
        setBuffers(null);
        setConvex(null);
      }

      fitToResults([result.buffers ?? null, result.convexHull ?? null, result.rings ?? null, result.ringHulls ?? null]);
      toast.success(result.method === 'basic' ? 'Grazing buffers generated successfully' : 'Advanced grazing rings generated');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process grazing maps';
      setUploadError(message);
      toast.error(message);
      resetResults();
    } finally {
      setIsProcessing(false);
    }
  }, [
    basicAlpha,
    basicColor,
    basicHexInput,
    boundaryFile,
    fitToResults,
    folderName,
    method,
    pointsFile,
    resetResults,
    ringColors,
    ringHexInputs,
  ]);

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

  const hasBasicResults = Boolean(method === 'basic' && buffers && convex && summary);
  const hasAdvancedResults = Boolean(method === 'advanced' && (rings || ringHulls) && summary);
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
            {buffers && <GeoJSON key="buffers" data={buffers as any} style={featureStyle as any} />}
            {convex && <GeoJSON key="convex" data={convex as any} style={featureStyle as any} />}
            {rings && <GeoJSON key="rings" data={rings as any} style={featureStyle as any} />}
            {ringHulls && <GeoJSON key="ring-hulls" data={ringHulls as any} style={featureStyle as any} />}
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
                  ? 'Basic: buffers every trough by 3 km, creates a concave alpha hull that honours holes, and clips to the supplied boundary.'
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

              <div className="space-y-2">
                <Label htmlFor="grazing-folder-name" className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Output Folder Name
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    id="grazing-folder-name"
                    type="text"
                    placeholder="e.g., 252 Postmans Ridge Road"
                    value={folderName}
                    onChange={(event) => setFolderName(event.target.value)}
                    className="text-sm flex-1"
                    maxLength={120}
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setFolderName((prev) => formatFolderName(prev))}
                    disabled={!folderName.trim()}
                    className="flex items-center gap-1 shrink-0"
                  >
                    <TextAa className="w-4 h-4" />
                    Format
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Applies consistent casing and punctuation in the exported KMZ/KML names. Leave empty to use defaults.
                </p>
              </div>

              {method === 'basic' ? (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Buffer Colour
                    </Label>
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        type="color"
                        value={basicColor}
                        onChange={handleBasicColorPickerChange}
                        className="h-10 w-16 cursor-pointer rounded border border-input bg-background p-1"
                        aria-label="Choose buffer colour"
                      />
                      <Input
                        value={basicHexInput}
                        onChange={handleBasicHexInputChange}
                        onBlur={handleBasicHexInputBlur}
                        maxLength={7}
                        className="w-28 font-mono text-xs uppercase"
                        aria-label="Hex buffer colour"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={handleBasicColorReset}
                        disabled={basicColorIsDefault}
                      >
                        Reset
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Used for the 3 km buffers and concave hull. Fill opacity is fixed at 40% with a 4 px black outline.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Concave Hull Alpha
                    </Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        type="number"
                        step="0.0001"
                        min={MIN_CONCAVE_ALPHA}
                        max={MAX_CONCAVE_ALPHA}
                        value={basicAlpha}
                        onChange={handleBasicAlphaChange}
                        onBlur={handleBasicAlphaBlur}
                        className="w-32 text-xs"
                        aria-label="Concave hull alpha"
                      />
                      <span className="text-[11px] text-muted-foreground">
                        Smaller = tighter hull, larger = smoother (range {MIN_CONCAVE_ALPHA}–{MAX_CONCAVE_ALPHA}).
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Ring Colours
                  </Label>
                  <div className="space-y-2">
                    {ringColorRows.map((row) => (
                      <div key={row.label} className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="w-28 text-foreground font-medium">{row.label}</span>
                        <input
                          type="color"
                          value={row.color}
                          onChange={(event) => handleRingColorPickerChange(row.index, event.target.value)}
                          className="h-9 w-14 cursor-pointer rounded border border-input bg-background p-1"
                          aria-label={`Colour for ${row.label}`}
                        />
                        <Input
                          value={row.hex}
                          onChange={(event) => handleRingHexInputChange(row.index, event.target.value)}
                          onBlur={() => handleRingHexInputBlur(row.index)}
                          maxLength={7}
                          className="w-24 font-mono text-xs uppercase"
                          aria-label={`Hex colour for ${row.label}`}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={handleRingColorReset}
                        disabled={ringColorsAreDefault}
                      >
                        Reset Colours
                      </Button>
                      <span>Outer ring keeps a 4 px black outline automatically.</span>
                    </div>
                    <span>Fill opacity is fixed at 40% so the three ring classes remain comparable.</span>
                  </div>
                </div>
              )}

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
                <div className="space-y-3 text-xs">
                  <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
                    <Badge variant="secondary" className="px-2 py-0.5">
                      {summary.pointCount} point{summary.pointCount === 1 ? '' : 's'}
                    </Badge>
                    <span>
                      Total polygon area: <strong>{summary.bufferAreaHa.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha</strong>
                    </span>
                    <span>
                      {method === 'basic' ? 'Concave hull area:' : 'Total hull area:'}{' '}
                      <strong>{summary.convexAreaHa.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha</strong>
                    </span>
                  </div>

                  {method === 'advanced' && ringSummaryWithColors.length > 0 ? (
                    <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Ring Classes
                      </div>
                      <div className="space-y-2">
                        {ringSummaryWithColors.map((ring) => (
                          <div key={ring.label} className="rounded-md bg-background/60 p-3 text-[11px] text-muted-foreground">
                            <div className="flex items-center justify-between gap-2 text-foreground">
                              <div className="flex items-center gap-2">
                                <span
                                  className="inline-flex h-3 w-3 rounded-full border border-border"
                                  style={{ backgroundColor: ring.color ?? '#94a3b8', opacity: MAP_FILL_OPACITY }}
                                  aria-hidden
                                />
                                <span className="font-medium text-sm">{ring.label} km</span>
                              </div>
                              <span>Weight {ring.weight.toFixed(2)}</span>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-y-1 gap-x-4">
                              <span>Ring area</span>
                              <span className="text-right text-foreground">
                                {ring.areaHa.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha
                              </span>
                              <span>Convex hull area</span>
                              <span className="text-right text-foreground">
                                {typeof ring.hullAreaHa === 'number'
                                  ? `${ring.hullAreaHa.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha`
                                  : '—'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border bg-muted/40 p-3 space-y-3">
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span
                          className="inline-flex h-3 w-3 rounded-full border border-border"
                          style={{ backgroundColor: basicColor, opacity: MAP_FILL_OPACITY }}
                          aria-hidden
                        />
                        <span>{basicColor}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">3 km Buffers</span>
                        <span className="text-muted-foreground">
                          {summary.bufferAreaHa.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">Concave Hull</span>
                        <span className="text-muted-foreground">
                          {summary.convexAreaHa.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>Alpha parameter</span>
                        <span>{basicAlpha}</span>
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
