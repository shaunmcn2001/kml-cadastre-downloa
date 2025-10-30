import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { MapPin, MagnifyingGlass, XCircle } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { OpenStreetMapProvider } from 'leaflet-geosearch';
import type { PropertyReportLayerResult, ParcelFeature } from '@/lib/types';

const basemapConfig = {
  streets: {
    label: 'Modern Streets',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
  },
  satellite: {
    label: 'Esri Satellite',
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
  }
} as const;

type BaseLayerKey = keyof typeof basemapConfig;

const fallbackPalette = ['#2563eb', '#22c55e', '#f97316', '#a855f7', '#ec4899', '#0ea5e9', '#facc15'];

type LegendFeatureEntry = {
  id: string;
  label: string;
  color: string;
  areaText?: string;
};

type LegendGroupEntry = {
  layerId: string;
  layerLabel: string;
  geometryType: string;
  active: boolean;
  features: LegendFeatureEntry[];
};

const cleanText = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }
  const text = String(value).trim();
  return text.length ? text : undefined;
};

const parseNumeric = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim();
    if (!cleaned) return undefined;
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const buildAreaText = (properties: Record<string, any> | undefined): string | undefined => {
  if (!properties) return undefined;
  const areaHa = parseNumeric(properties.area_ha ?? properties.areaHa);
  if (areaHa !== undefined && areaHa > 0) {
    const decimals = areaHa >= 100 ? 0 : areaHa >= 10 ? 1 : 2;
    return `${areaHa.toFixed(decimals)} ha`;
  }
  const areaM2 = parseNumeric(properties.area_m2 ?? properties.areaM2);
  if (areaM2 !== undefined && areaM2 > 0) {
    const hectares = areaM2 / 10000;
    const decimals = hectares >= 100 ? 0 : hectares >= 10 ? 1 : 2;
    return `${hectares.toFixed(decimals)} ha`;
  }
  return undefined;
};

const buildFeatureLabel = (properties: Record<string, any> | undefined, fallback: string): string => {
  const props = properties ?? {};
  const nameCandidates = [
    cleanText(props.display_name),
    cleanText(props.name),
    cleanText(props.layer_title),
    cleanText(props.alias),
    cleanText(props.title),
    cleanText(props.description),
  ];
  let label = nameCandidates.find(Boolean) ?? fallback;

  const codeCandidates = [
    cleanText(props.code),
    cleanText(props.lt_code),
    cleanText(props.lt_code_1),
    cleanText(props.rvm_cat),
    cleanText(props.category),
    cleanText(props.status),
    cleanText(props.parcel_type),
  ];
  const code = codeCandidates.find(Boolean);
  if (code) {
    const lowerLabel = label.toLowerCase();
    if (!lowerLabel.includes(code.toLowerCase())) {
      label = `${label} (${code})`;
    }
  }

  return label;
};

interface PropertyReportMapProps {
  parcels?: ParcelFeature[];
  layers: PropertyReportLayerResult[];
  layerVisibility: Record<string, boolean>;
  datasetColors?: Record<string, string>;
  onToggleLayer: (id: string) => void;
}

function useGeoJsonLayer(map: L.Map | null, data: any, options: L.GeoJSONOptions) {
  const layerRef = useRef<L.GeoJSON | null>(null);

  useEffect(() => {
    if (!map) return;

    if (layerRef.current) {
      layerRef.current.remove();
      layerRef.current = null;
    }

    if (!data || !data.features?.length) {
      return;
    }

    const layer = L.geoJSON(data, options).addTo(map);
    layerRef.current = layer;

    return () => {
      layer.remove();
      layerRef.current = null;
    };
  }, [map, data, options]);

  return layerRef;
}

export function PropertyReportMap({
  parcels,
  layers,
  layerVisibility,
  datasetColors = {},
  onToggleLayer,
}: PropertyReportMapProps) {
  const [baseLayer, setBaseLayer] = useState<BaseLayerKey>('streets');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const searchMarkerRef = useRef<L.Marker | null>(null);

  const parcelCollection = useMemo(() => {
    if (!parcels?.length) return null;
    return {
      type: 'FeatureCollection' as const,
      features: parcels as any,
    };
  }, [parcels]);

  const parcelsLayer = useGeoJsonLayer(
    mapInstance,
    parcelCollection,
    {
      style: () => ({
        color: '#1f2937',
        weight: 2.5,
        fillOpacity: 0.05,
      }),
    }
  );

  const resolveDatasetColor = (layerId: string, fallback: string) =>
    datasetColors[layerId] || fallback;

  const pickFeatureColor = (feature: any, datasetColor: string) => {
    const fromFeature = feature?.properties?.layer_color;
    if (typeof fromFeature === 'string' && fromFeature.trim()) {
      return fromFeature;
    }
    return datasetColor;
  };

  const styleForFeature = (feature: any, datasetColor: string, geometryType: string) => {
    const color = pickFeatureColor(feature, datasetColor);
    return {
      color,
      fillColor: color,
      weight: geometryType === 'polyline' ? 2 : 1.25,
      fillOpacity: geometryType === 'polygon' ? 0.3 : 0,
      opacity: 0.95,
    };
  };

  const datasetLayersRef = useRef<Record<string, L.GeoJSON>>({});

  useEffect(() => {
    const map = mapInstance;
    if (!map) return;

    // Remove existing dataset layers
    Object.values(datasetLayersRef.current).forEach(layer => layer.remove());
    datasetLayersRef.current = {};

    layers.forEach((layer, index) => {
      const fallbackColor = layer.color || fallbackPalette[index % fallbackPalette.length];
      const datasetColor = resolveDatasetColor(layer.id, fallbackColor);
      const geojsonLayer = L.geoJSON(layer.featureCollection as any, {
        style: (feature: any) => styleForFeature(feature, datasetColor, layer.geometryType),
        pointToLayer: (feature, latlng) => {
          const featureColor = pickFeatureColor(feature, datasetColor);
          return L.circleMarker(latlng, {
            radius: 5,
            fillColor: featureColor,
            color: featureColor,
            weight: 1,
            fillOpacity: 0.9,
          });
        },
      });

      datasetLayersRef.current[layer.id] = geojsonLayer;
      if (layerVisibility[layer.id] !== false) {
        geojsonLayer.addTo(map);
      }
    });

    // Fit bounds to parcels if available
    if (parcelCollection?.features?.length) {
      const group = new L.FeatureGroup(
        parcelCollection.features.map((feature: any) => L.geoJSON(feature))
      );
      map.fitBounds(group.getBounds(), { padding: [20, 20] });
    } else if (layers.length) {
      const group = new L.FeatureGroup(
        layers.flatMap(layer =>
          layer.featureCollection.features.map((feature: any) => L.geoJSON(feature))
        )
      );
      if (group.getLayers().length > 0) {
        map.fitBounds(group.getBounds(), { padding: [20, 20] });
      }
    }

    return () => {
      Object.values(datasetLayersRef.current).forEach(layer => layer.remove());
      datasetLayersRef.current = {};
    };
  }, [layers, parcelCollection, layerVisibility, mapInstance, datasetColors]);

  useEffect(() => {
    const map = mapInstance;
    if (!map) return;

    Object.entries(datasetLayersRef.current).forEach(([id, layer]) => {
      if (layerVisibility[id] === false) {
        if (map.hasLayer(layer)) {
          map.removeLayer(layer);
        }
      } else if (!map.hasLayer(layer)) {
        layer.addTo(map);
      }
    });
  }, [layerVisibility, mapInstance]);

  const handleLayerToggle = (layerId: string) => {
    onToggleLayer(layerId);
  };

  const legendGroups = useMemo<LegendGroupEntry[]>(() => {
    return layers
      .map((layer, index) => {
        const fallbackColor = layer.color || fallbackPalette[index % fallbackPalette.length];
        const datasetColor = resolveDatasetColor(layer.id, fallbackColor);
        const active = layerVisibility[layer.id] !== false;

        const features: LegendFeatureEntry[] = (layer.featureCollection?.features ?? []).map((feature: any, featureIndex: number) => {
          const properties: Record<string, any> = feature?.properties ?? {};
          const color = pickFeatureColor(feature, datasetColor);
          const fallback = `${layer.label} ${featureIndex + 1}`;
          const label = buildFeatureLabel(properties, fallback);
          const areaText = buildAreaText(properties);
          const id =
            cleanText(properties.id) ||
            cleanText(properties.code) ||
            cleanText(properties.lotplan) ||
            `${layer.id}-${featureIndex}`;

          return {
            id,
            label,
            color,
            areaText,
          };
        });

        if (!features.length) {
          return null;
        }

        const uniqueFeatures = features.filter((feature, index, array) =>
          array.findIndex(candidate => candidate.id === feature.id) === index
        );

        return {
          layerId: layer.id,
          layerLabel: layer.label,
          geometryType: layer.geometryType,
          active,
          features: uniqueFeatures,
        };
      })
      .filter((entry): entry is LegendGroupEntry => Boolean(entry));
  }, [layers, layerVisibility, datasetColors]);

  const totalLegendFeatures = useMemo(
    () => legendGroups.reduce((sum, group) => sum + group.features.length, 0),
    [legendGroups]
  );

  const handleSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!searchTerm.trim() || !mapInstance) {
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

      searchMarkerRef.current = L.marker(latLng).addTo(mapInstance);
      searchMarkerRef.current.bindPopup(`<strong>${label}</strong>`).openPopup();

      mapInstance.flyTo(latLng, 16, { animate: true, duration: 1.2 });
    } catch (error) {
      console.error('Geocode failed', error);
      setSearchError('Unable to search that address right now');
    } finally {
      setIsSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchTerm('');
    setSearchError(null);
    if (searchMarkerRef.current) {
      searchMarkerRef.current.remove();
      searchMarkerRef.current = null;
    }
  };

  return (
    <Card className="h-full flex flex-col min-h-[520px]">
      <CardHeader className="px-4 py-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-700">
            <MapPin className="w-4 h-4" />
            Property Report Map
          </CardTitle>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <Label htmlFor="property-basemap" className="text-[11px] font-medium text-muted-foreground">
                Base Layer
              </Label>
              <Select value={baseLayer} onValueChange={(value: BaseLayerKey) => setBaseLayer(value)}>
                <SelectTrigger id="property-basemap" className="h-8 w-[160px] text-xs">
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
              <p className="text-[11px] text-destructive/90 max-w-xs">{searchError}</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 mt-2">
          {layers.map((layer, index) => {
            const color = resolveDatasetColor(
              layer.id,
              layer.color || fallbackPalette[index % fallbackPalette.length]
            );
            const active = layerVisibility[layer.id] !== false;
            return (
              <button
                key={layer.id}
                type="button"
                onClick={() => handleLayerToggle(layer.id)}
                className={`group flex items-center justify-between rounded-xl border px-3 py-2 text-left transition ${
                  active ? 'border-primary/40 bg-primary/10 shadow-sm' : 'border-border hover:bg-muted'
                }`}
                style={active ? { borderColor: color } : undefined}
              >
                <div className="flex items-center gap-3 pointer-events-none">
                  <div className="flex flex-col">
                    <span className={`text-xs font-medium ${active ? 'text-slate-700' : 'text-muted-foreground'}`}>
                      {layer.label}
                    </span>
                    <span className="text-[11px] uppercase tracking-wide text-slate-500">
                      {layer.group ? `${layer.group} • ${layer.geometryType}` : layer.geometryType}
                    </span>
                  </div>
                </div>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 pointer-events-none">
                  {layer.featureCount}
                </Badge>
              </button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-0 flex flex-col">
        <div className="relative flex-1 min-h-[480px] overflow-hidden rounded-b-lg">
          <MapContainer
            center={[-23.5, 146.3]}
            zoom={6}
            className="h-full w-full"
            zoomControl={true}
            whenCreated={(map) => {
              setMapInstance(map);
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
          </MapContainer>

          {!layers.length && !parcelCollection && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-muted/15 backdrop-blur-sm">
              <div className="text-center text-muted-foreground">
                <MapPin className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm font-medium">Awaiting parcel selection</p>
                <p className="text-xs text-muted-foreground/70">Enter lot/plan values and choose datasets to view property reports.</p>
              </div>
            </div>
          )}
        </div>

        {legendGroups.length > 0 && (
          <div className="border-t bg-muted/10 px-4 py-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Feature Summary</p>
              <span className="text-[11px] text-muted-foreground">{totalLegendFeatures} features</span>
            </div>
            <div className="mt-3 space-y-3">
              {legendGroups.map(group => (
                <div key={group.layerId} className="rounded-lg border border-border/60 bg-background/85 shadow-sm">
                  <div className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2">
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-foreground">{group.layerLabel}</span>
                      <span className="text-[10px] text-muted-foreground/70">
                        {group.geometryType}
                        {group.active ? '' : ' · Hidden'}
                      </span>
                    </div>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {group.features.length}
                    </Badge>
                  </div>
                  <ul className="divide-y divide-border/40 text-xs" role="list">
                    {group.features.map(feature => (
                      <li key={feature.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-flex h-3 w-3 flex-shrink-0 rounded border border-border/50"
                            style={{
                              backgroundColor: feature.color,
                              opacity: group.active ? 0.9 : 0.2,
                            }}
                            aria-hidden="true"
                          />
                          <span className={`font-medium ${group.active ? 'text-foreground' : 'text-muted-foreground/70'}`}>
                            {feature.label}
                          </span>
                        </div>
                        {feature.areaText && (
                          <span className="text-[10px] text-muted-foreground/60">{feature.areaText}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
