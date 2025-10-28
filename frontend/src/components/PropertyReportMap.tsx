import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { MapPin, MagnifyingGlass, XCircle } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
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

const layerPalette = ['#2563eb', '#22c55e', '#f97316', '#a855f7', '#ec4899', '#0ea5e9', '#facc15'];

interface PropertyReportMapProps {
  parcels?: ParcelFeature[];
  layers: PropertyReportLayerResult[];
  layerVisibility: Record<string, boolean>;
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

export function PropertyReportMap({ parcels, layers, layerVisibility, onToggleLayer }: PropertyReportMapProps) {
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

  const datasetLayersRef = useRef<Record<string, L.GeoJSON>>({});

  useEffect(() => {
    const map = mapInstance;
    if (!map) return;

    // Remove existing dataset layers
    Object.values(datasetLayersRef.current).forEach(layer => layer.remove());
    datasetLayersRef.current = {};

    layers.forEach((layer, index) => {
      const color = layerPalette[index % layerPalette.length];
      const geojsonLayer = L.geoJSON(layer.featureCollection as any, {
        style: () => ({
          color,
          weight: layer.geometryType === 'polyline' ? 2 : 1.25,
          fillOpacity: layer.geometryType === 'polygon' ? 0.25 : 0,
        }),
        pointToLayer: (_feature, latlng) =>
          L.circleMarker(latlng, {
            radius: 5,
            fillColor: color,
            color,
            weight: 1,
            fillOpacity: 0.9,
          }),
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
  }, [layers, parcelCollection, layerVisibility, mapInstance]);

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
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="w-4 h-4" />
            Property Report Map
          </CardTitle>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 text-xs">
            <div className="flex items-center gap-2">
              <Label htmlFor="property-basemap" className="text-xs font-medium text-muted-foreground">
                Base Layer
              </Label>
              <Select value={baseLayer} onValueChange={(value: BaseLayerKey) => setBaseLayer(value)}>
                <SelectTrigger id="property-basemap" className="h-8 w-[180px] text-xs">
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

        <div className="flex flex-wrap gap-3 mt-4">
          {layers.map((layer, index) => (
            <div key={layer.id} className="flex items-center space-x-2">
              <Switch
                id={`dataset-${layer.id}`}
                checked={layerVisibility[layer.id] !== false}
                onCheckedChange={() => handleLayerToggle(layer.id)}
                className="scale-75"
              />
              <Label
                htmlFor={`dataset-${layer.id}`}
                className="text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <div
                  className="w-3 h-3 rounded-sm border"
                  style={{
                    backgroundColor: layerPalette[index % layerPalette.length],
                    opacity: layerVisibility[layer.id] !== false ? 0.6 : 0.15,
                    borderColor: layerPalette[index % layerPalette.length],
                  }}
                />
                {layer.label}
                <Badge variant="secondary" className="text-xs px-1.5 py-0">
                  {layer.featureCount}
                </Badge>
              </Label>
            </div>
          ))}
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-0 relative min-h-[480px]">
        <div className="absolute inset-0 rounded-b-lg overflow-hidden">
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
      </CardContent>
    </Card>
  );
}
