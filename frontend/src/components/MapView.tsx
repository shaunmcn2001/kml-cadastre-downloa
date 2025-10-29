import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type {
  ParcelFeature,
  ParcelState,
  LandTypeFeatureCollection,
  LandTypeLegendEntry,
} from '../lib/types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  MapPin,
  MagnifyingGlass,
  XCircle,
  ArrowClockwise,
  WarningCircle,
} from '@phosphor-icons/react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LandTypeLayer } from './LandTypeLayer';
import { OpenStreetMapProvider } from 'leaflet-geosearch';

// Fix for default markers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

type LandTypeSource = 'lotplans' | 'bbox';

interface MapViewProps {
  features: ParcelFeature[];
  isLoading: boolean;
  landTypeAvailable: boolean;
  landTypeEnabled: boolean;
  landTypeIsLoading: boolean;
  landTypeData: LandTypeFeatureCollection | null;
  landTypeLegend: LandTypeLegendEntry[];
  landTypeWarnings: string[];
  landTypeSource: LandTypeSource;
  landTypeLotPlans: string[];
  onLandTypeToggle: (enabled: boolean) => void;
  onLandTypeSourceChange: (source: LandTypeSource) => void;
  onLandTypeRefresh: () => void;
  onLandTypeRefreshBbox: (bbox: [number, number, number, number]) => void;
}

const stateColors: Record<ParcelState, string> = {
  NSW: '#1f2937',
  QLD: '#7c2d12',
  SA: '#14532d',
  VIC: '#6b21a8',
};

function MapUpdater({ features }: { features: ParcelFeature[] }) {
  const map = useMap();

  useEffect(() => {
    if (features.length > 0) {
      const group = new L.FeatureGroup(features.map((feature) => L.geoJSON(feature as any)));
      const bounds = group.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [20, 20] });
      }
    }
  }, [features, map]);

  return null;
}

function formatNumber(value?: number): string {
  if (value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function MapView({
  features,
  isLoading,
  landTypeAvailable,
  landTypeEnabled,
  landTypeIsLoading,
  landTypeData,
  landTypeLegend,
  landTypeWarnings,
  landTypeSource,
  landTypeLotPlans,
  onLandTypeToggle,
  onLandTypeSourceChange,
  onLandTypeRefresh,
  onLandTypeRefreshBbox,
}: MapViewProps) {
  const [layerVisibility, setLayerVisibility] = useState<Record<ParcelState, boolean>>({
    NSW: true,
    QLD: true,
    SA: true,
    VIC: true,
  });
  const [baseLayer, setBaseLayer] = useState<'streets' | 'satellite'>('streets');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const searchMarkerRef = useRef<L.Marker | null>(null);

  const basemapConfig = {
    streets: {
      label: 'Modern Streets',
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    },
    satellite: {
      label: 'Esri Satellite',
      attribution:
        'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    },
  } as const;

  const filteredFeatures = useMemo(
    () => features.filter((feature) => layerVisibility[feature.properties.state]),
    [features, layerVisibility],
  );

  const hasParcelFeatures = filteredFeatures.length > 0;
  const hasLandTypeFeatures =
    landTypeEnabled && !!landTypeData && (landTypeData.features?.length ?? 0) > 0;

  const canUseLotPlans = landTypeLotPlans.length > 0;
  const usingLotPlans = landTypeSource === 'lotplans';

  const onEachFeature = useCallback((feature: any, layer: any) => {
    if (!feature.properties) {
      return;
    }
    const color = stateColors[feature.properties.state as ParcelState] ?? '#111827';

    layer.setStyle({
      fillColor: color,
      fillOpacity: 0.3,
      color,
      weight: 2,
      opacity: 0.8,
    });

    const props = feature.properties;
    const popupContent = `
      <div class="font-mono text-xs">
        <div class="font-semibold mb-1">${props.name || props.id}</div>
        <div class="space-y-0.5">
          <div><span class="font-medium">State:</span> ${props.state}</div>
          ${props.lotplan ? `<div><span class="font-medium">Lot/Plan:</span> ${props.lotplan}</div>` : ''}
          ${
            props.area_ha
              ? `<div><span class="font-medium">Area:</span> ${Number(props.area_ha).toFixed(
                  2,
                )} ha</div>`
              : ''
          }
          ${props.title_ref ? `<div><span class="font-medium">Title:</span> ${props.title_ref}</div>` : ''}
          ${props.address ? `<div><span class="font-medium">Address:</span> ${props.address}</div>` : ''}
        </div>
      </div>
    `;

    layer.bindPopup(popupContent, {
      maxWidth: 300,
      className: 'custom-popup',
    });

    layer.on({
      mouseover: (event: any) => {
        const target = event.target;
        target.setStyle({
          fillOpacity: 0.5,
          weight: 3,
        });
      },
      mouseout: (event: any) => {
        const target = event.target;
        target.setStyle({
          fillOpacity: 0.3,
          weight: 2,
        });
      },
    });
  }, []);

  const toggleLayer = useCallback(
    (state: ParcelState) => {
      setLayerVisibility((prev) => ({
        ...prev,
        [state]: !prev[state],
      }));
    },
    [setLayerVisibility],
  );

  const getStateCounts = useCallback(() => {
    const counts: Record<ParcelState, number> = { NSW: 0, QLD: 0, SA: 0, VIC: 0 };
    features.forEach((feature) => {
      counts[feature.properties.state]++;
    });
    return counts;
  }, [features]);

  const stateCounts = getStateCounts();

  const handleSearch = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!searchTerm.trim() || !mapRef.current) {
        return;
      }

      setIsSearching(true);
      setSearchError(null);

      try {
        const provider = new OpenStreetMapProvider();
        const results = await provider.search({ query: searchTerm.trim() });

        if (!results.length) {
          setSearchError('No matching address found');
          return;
        }

        const { x, y, label } = results[0];
        const latLng = L.latLng(y, x);

        if (searchMarkerRef.current) {
          searchMarkerRef.current.remove();
        }

        searchMarkerRef.current = L.marker(latLng, {
          icon: L.icon({
            iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
            iconRetinaUrl:
              'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
            iconAnchor: [12, 41],
          }),
        }).addTo(mapRef.current);

        searchMarkerRef.current.bindPopup(`<strong>${label}</strong>`).openPopup();
        mapRef.current.flyTo(latLng, 16, { animate: true, duration: 1.2 });
      } catch (error) {
        console.error('Geosearch failed', error);
        setSearchError('Unable to search that address right now');
      } finally {
        setIsSearching(false);
      }
    },
    [searchTerm],
  );

  const clearSearch = useCallback(() => {
    setSearchTerm('');
    setSearchError(null);
    if (searchMarkerRef.current) {
      searchMarkerRef.current.remove();
      searchMarkerRef.current = null;
    }
  }, []);

  const handleLandTypeToggle = useCallback(
    (checked: boolean) => {
      onLandTypeToggle(checked);
      if (!checked) {
        return;
      }
      if (landTypeSource === 'bbox') {
        if (mapRef.current) {
          const bounds = mapRef.current.getBounds();
          const bbox: [number, number, number, number] = [
            bounds.getWest(),
            bounds.getSouth(),
            bounds.getEast(),
            bounds.getNorth(),
          ];
          onLandTypeRefreshBbox(bbox);
        }
      } else {
        onLandTypeRefresh();
      }
    },
    [landTypeSource, onLandTypeRefresh, onLandTypeRefreshBbox, onLandTypeToggle],
  );

  const handleSelectLotPlanSource = useCallback(() => {
    onLandTypeSourceChange('lotplans');
    if (landTypeEnabled) {
      onLandTypeRefresh();
    }
  }, [landTypeEnabled, onLandTypeRefresh, onLandTypeSourceChange]);

  const handleSelectMapExtentSource = useCallback(() => {
    if (!mapRef.current) {
      return;
    }
    const bounds = mapRef.current.getBounds();
    const bbox: [number, number, number, number] = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];
    onLandTypeSourceChange('bbox');
    onLandTypeRefreshBbox(bbox);
  }, [onLandTypeRefreshBbox, onLandTypeSourceChange]);

  const handleLandTypeRefreshClick = useCallback(() => {
    if (landTypeSource === 'bbox') {
      if (!mapRef.current) {
        return;
      }
      const bounds = mapRef.current.getBounds();
      const bbox: [number, number, number, number] = [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ];
      onLandTypeRefreshBbox(bbox);
    } else {
      onLandTypeRefresh();
    }
  }, [landTypeSource, onLandTypeRefresh, onLandTypeRefreshBbox]);

  return (
    <Card className="h-full flex flex-col min-h-[520px]">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="w-4 h-4" />
            Interactive Map
            {isLoading && (
              <div className="w-4 h-4 animate-spin border-2 border-primary border-t-transparent rounded-full" />
            )}
          </CardTitle>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 text-xs">
            <div className="flex items-center gap-2">
              <Label htmlFor="basemap-select" className="text-xs font-medium text-muted-foreground">
                Base Layer
              </Label>
              <Select
                value={baseLayer}
                onValueChange={(value: 'streets' | 'satellite') => setBaseLayer(value)}
              >
                <SelectTrigger id="basemap-select" className="h-8 w-[180px] text-xs">
                  <SelectValue placeholder="Select basemap" />
                </SelectTrigger>
                <SelectContent className="text-xs">
                  <SelectItem value="streets">{basemapConfig.streets.label}</SelectItem>
                  <SelectItem value="satellite">{basemapConfig.satellite.label}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <form onSubmit={handleSearch} className="flex items-center gap-2">
              <div className="relative">
                <MagnifyingGlass className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(event) => {
                    setSearchTerm(event.target.value);
                    if (searchError) {
                      setSearchError(null);
                    }
                  }}
                  placeholder="Search address or place"
                  className="h-8 w-[200px] pl-7 text-xs"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Button type="submit" size="sm" disabled={isSearching} className="h-8 text-xs">
                {isSearching ? 'Searching…' : 'Go'}
              </Button>
            </form>
            {searchError && (
              <p className="text-[11px] text-destructive/90">{searchError}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mt-4">
          {(['NSW', 'QLD', 'SA', 'VIC'] as ParcelState[]).map((state) => (
            <div key={state} className="flex items-center space-x-2">
              <Switch
                id={`layer-${state}`}
                checked={layerVisibility[state]}
                onCheckedChange={() => toggleLayer(state)}
                className="scale-75"
              />
              <Label htmlFor={`layer-${state}`} className="text-xs flex items-center gap-1.5 cursor-pointer">
                <div
                  className="w-3 h-3 rounded-sm border"
                  style={{
                    backgroundColor: stateColors[state],
                    opacity: layerVisibility[state] ? 0.3 : 0.1,
                    borderColor: stateColors[state],
                  }}
                />
                {state}
                {stateCounts[state] > 0 && (
                  <Badge variant="secondary" className="text-xs px-1.5 py-0">
                    {stateCounts[state]}
                  </Badge>
                )}
              </Label>
            </div>
          ))}
        </div>

        {landTypeAvailable && (
          <div className="mt-5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-primary/80">
                  LandType Overlay
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 leading-tight">
                  QLD land-type polygons styled for Google Earth. Choose parcel lotplans or current map extent.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="landtype-toggle"
                  checked={landTypeEnabled}
                  onCheckedChange={handleLandTypeToggle}
                  className="scale-75"
                />
                <Label htmlFor="landtype-toggle" className="text-xs font-medium">
                  {landTypeEnabled ? 'Enabled' : 'Disabled'}
                </Label>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={usingLotPlans ? 'default' : 'outline'}
                onClick={handleSelectLotPlanSource}
                disabled={!canUseLotPlans}
                className="h-7 text-[11px]"
              >
                Lotplans {canUseLotPlans ? `(${landTypeLotPlans.length})` : ''}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={!usingLotPlans ? 'default' : 'outline'}
                onClick={handleSelectMapExtentSource}
                className="h-7 text-[11px]"
              >
                Map Extent
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleLandTypeRefreshClick}
                disabled={
                  !landTypeEnabled ||
                  landTypeIsLoading ||
                  (usingLotPlans && !canUseLotPlans)
                }
                className="h-7 text-[11px]"
              >
                <ArrowClockwise
                  className={`h-3.5 w-3.5 mr-2 ${landTypeIsLoading ? 'animate-spin' : ''}`}
                />
                {landTypeIsLoading ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>

            <div className="mt-2 space-y-1">
              {usingLotPlans ? (
                <p className="text-[11px] text-muted-foreground">
                  {canUseLotPlans
                    ? `Using ${landTypeLotPlans.length} QLD lotplan${landTypeLotPlans.length === 1 ? '' : 's'}.`
                    : 'No QLD lots available — switch to Map Extent to query LandType coverage.'}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Using current map extent (pan/zoom and refresh to update LandType polygons).
                </p>
              )}
              {landTypeWarnings.map((warning, index) => (
                <div key={index} className="flex items-start gap-1.5 text-[11px] text-primary/90">
                  <WarningCircle className="h-3.5 w-3.5 mt-0.5" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="flex-1 p-0 relative min-h-[480px]">
        {landTypeEnabled && landTypeIsLoading && (
          <div className="absolute right-4 top-4 z-[750] flex items-center gap-2 rounded-full bg-background/85 px-3 py-1 text-xs shadow">
            <div className="h-3 w-3 animate-spin border-2 border-primary border-t-transparent rounded-full" />
            <span className="font-medium text-muted-foreground">Loading LandType…</span>
          </div>
        )}

        <div className="absolute inset-0 rounded-b-lg overflow-hidden">
          <MapContainer
            center={[-27.4705, 133]}
            zoom={6}
            className="h-full w-full"
            zoomControl
            whenCreated={(mapInstance) => {
              mapRef.current = mapInstance;
            }}
            style={{ background: 'transparent' }}
          >
            <TileLayer
              key={baseLayer}
              attribution={basemapConfig[baseLayer].attribution}
              url={basemapConfig[baseLayer].url}
            />
            {baseLayer === 'satellite' && (
              <TileLayer
                key="satellite-labels"
                opacity={0.7}
                attribution="Boundaries © Esri"
                url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
              />
            )}
            <GeoJSON
              key={`${filteredFeatures.length}-${Object.values(layerVisibility).join()}`}
              data={{ type: 'FeatureCollection', features: filteredFeatures } as any}
              onEachFeature={onEachFeature}
            />
            {landTypeAvailable && (
              <LandTypeLayer enabled={landTypeEnabled} data={landTypeData} />
            )}
            <MapUpdater features={filteredFeatures} />
          </MapContainer>

          {!hasParcelFeatures && !hasLandTypeFeatures && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-muted/15 backdrop-blur-sm">
              <div className="text-center text-muted-foreground">
                <MapPin className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm font-medium">No parcel data to display</p>
                <p className="text-xs text-muted-foreground/70">Query parcels to see them on the map</p>
                <p className="text-[11px] text-muted-foreground/60 mt-1">
                  Compatible with Google Earth Pro &amp; Web
                </p>
              </div>
            </div>
          )}
        </div>

        {landTypeAvailable && landTypeEnabled && landTypeLegend.length > 0 && (
          <div className="border-t border-muted/40 bg-muted/10 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              LandType Legend
            </div>
            <div className="flex flex-wrap gap-3">
              {landTypeLegend.map((entry) => (
                <div key={entry.code} className="flex items-center gap-2 text-xs">
                  <span
                    className="h-3 w-3 rounded-sm border border-black/20"
                    style={{ backgroundColor: entry.color_hex || '#009FDF' }}
                  />
                  <div>
                    <div className="font-medium text-foreground leading-tight">
                      {entry.name || entry.code}
                    </div>
                    {typeof entry.area_ha === 'number' && (
                      <div className="text-[11px] text-muted-foreground leading-tight">
                        {formatNumber(entry.area_ha)} ha
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

MapView.displayName = 'MapView';
