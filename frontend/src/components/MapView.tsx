import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import 'leaflet-geosearch/dist/geosearch.css';
import type { ParcelFeature, ParcelState } from '../lib/types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { MapPin } from '@phosphor-icons/react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { GeoSearchControl, OpenStreetMapProvider } from 'leaflet-geosearch';

// Fix for default markers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface MapViewProps {
  features: ParcelFeature[];
  isLoading: boolean;
}

const stateColors = {
  NSW: '#1f2937', // Dark blue-gray
  QLD: '#7c2d12', // Dark red
  SA: '#14532d',  // Dark green
  VIC: '#6b21a8'  // Deep purple
};

function MapUpdater({ features }: { features: ParcelFeature[] }) {
  const map = useMap();
  
  useEffect(() => {
    if (features.length > 0) {
      const group = new L.FeatureGroup(
        features.map(feature => L.geoJSON(feature))
      );
      map.fitBounds(group.getBounds(), { padding: [20, 20] });
    }
  }, [features, map]);
  
  return null;
}

export function MapView({ features, isLoading }: MapViewProps) {
  const [layerVisibility, setLayerVisibility] = useState<Record<ParcelState, boolean>>({
    NSW: true,
    QLD: true,
    SA: true,
    VIC: true
  });
  const [baseLayer, setBaseLayer] = useState<'streets' | 'satellite'>('streets');

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

  const filteredFeatures = features.filter(feature => 
    layerVisibility[feature.properties.state]
  );

  const onEachFeature = (feature: any, layer: any) => {
    if (feature.properties) {
      const color = stateColors[feature.properties.state];
      
      layer.setStyle({
        fillColor: color,
        fillOpacity: 0.3,
        color: color,
        weight: 2,
        opacity: 0.8
      });

      // Create popup content
      const props = feature.properties;
      const popupContent = `
        <div class="font-mono text-xs">
          <div class="font-semibold mb-1">${props.name || props.id}</div>
          <div class="space-y-0.5">
            <div><span class="font-medium">State:</span> ${props.state}</div>
            ${props.lotplan ? `<div><span class="font-medium">Lot/Plan:</span> ${props.lotplan}</div>` : ''}
            ${props.area_ha ? `<div><span class="font-medium">Area:</span> ${Number(props.area_ha).toFixed(2)} ha</div>` : ''}
            ${props.title_ref ? `<div><span class="font-medium">Title:</span> ${props.title_ref}</div>` : ''}
            ${props.address ? `<div><span class="font-medium">Address:</span> ${props.address}</div>` : ''}
          </div>
        </div>
      `;
      
      layer.bindPopup(popupContent, {
        maxWidth: 300,
        className: 'custom-popup'
      });

      // Hover effects
      layer.on({
        mouseover: function(e: any) {
          const layer = e.target;
          layer.setStyle({
            fillOpacity: 0.5,
            weight: 3
          });
        },
        mouseout: function(e: any) {
          const layer = e.target;
          layer.setStyle({
            fillOpacity: 0.3,
            weight: 2
          });
        }
      });
    }
  };

  const toggleLayer = (state: ParcelState) => {
    setLayerVisibility(prev => ({
      ...prev,
      [state]: !prev[state]
    }));
  };

  const getStateCounts = () => {
    const counts: Record<ParcelState, number> = { NSW: 0, QLD: 0, SA: 0, VIC: 0 };
    features.forEach(feature => {
      counts[feature.properties.state]++;
    });
    return counts;
  };

  const stateCounts = getStateCounts();

  return (
    <Card className="h-full flex flex-col min-h-[520px]">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="w-4 h-4" />
            Interactive Map
            {isLoading && <div className="w-4 h-4 animate-spin border-2 border-primary border-t-transparent rounded-full" />}
          </CardTitle>

          <div className="flex items-center gap-2 text-xs">
            <Label htmlFor="basemap-select" className="text-xs font-medium text-muted-foreground">
              Base Layer
            </Label>
            <Select value={baseLayer} onValueChange={(value: 'streets' | 'satellite') => setBaseLayer(value)}>
              <SelectTrigger id="basemap-select" className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="Select basemap" />
              </SelectTrigger>
              <SelectContent className="text-xs">
                <SelectItem value="streets">{basemapConfig.streets.label}</SelectItem>
                <SelectItem value="satellite">{basemapConfig.satellite.label}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Layer Controls */}
        <div className="flex flex-wrap gap-3 mt-4">
          {(['NSW', 'QLD', 'SA', 'VIC'] as ParcelState[]).map(state => (
            <div key={state} className="flex items-center space-x-2">
              <Switch
                id={`layer-${state}`}
                checked={layerVisibility[state]}
                onCheckedChange={() => toggleLayer(state)}
                className="scale-75"
              />
              <Label 
                htmlFor={`layer-${state}`}
                className="text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <div 
                  className="w-3 h-3 rounded-sm border"
                  style={{
                    backgroundColor: stateColors[state],
                    opacity: layerVisibility[state] ? 0.3 : 0.1,
                    borderColor: stateColors[state]
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
      </CardHeader>

      <CardContent className="flex-1 p-0 relative min-h-[480px]">
        <div className="absolute inset-0 rounded-b-lg overflow-hidden">
          {filteredFeatures.length > 0 ? (
            <MapContainer
              center={[-27.4705, 133.0000]}
              zoom={6}
              className="h-full w-full"
              zoomControl={true}
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
                data={{
                  type: 'FeatureCollection',
                  features: filteredFeatures
                }}
                onEachFeature={onEachFeature}
              />
              <MapUpdater features={filteredFeatures} />
              <MapEnhancements />
            </MapContainer>
          ) : (
            <div className="flex items-center justify-center h-full bg-muted/20 rounded-b-lg">
              <div className="text-center text-muted-foreground">
                <MapPin className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No parcel data to display</p>
                <p className="text-xs mt-1">Query parcels to see them on the map</p>
                <p className="text-xs mt-2 italic">Compatible with Google Earth Pro & Web</p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MapEnhancements() {
  const map = useMap();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;

    map.pm.addControls({
      position: 'topright',
      drawCircle: true,
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: true,
      drawPolygon: true,
      drawRectangle: true,
      drawText: false,
      editMode: true,
      dragMode: false,
      cutPolygon: false,
      rotateMode: false,
      removalMode: true
    });

    map.pm.setGlobalOptions({
      measurements: true
    });

    initialized.current = true;

    return () => {
      map.pm.removeControls();
    };
  }, [map]);

  useEffect(() => {
    const provider = new OpenStreetMapProvider();
    const searchControl = new GeoSearchControl({
      provider,
      style: 'bar',
      position: 'topleft',
      showMarker: true,
      showPopup: false,
      retainZoomLevel: false,
      animateZoom: true,
      keepResult: true,
      searchLabel: 'Search address…'
    });

    map.addControl(searchControl);

    const container = searchControl.getContainer?.();
    if (container) {
      container.classList.add('geosearch-control');
    }

    return () => {
      map.removeControl(searchControl);
    };
  }, [map]);

  return null;
}
