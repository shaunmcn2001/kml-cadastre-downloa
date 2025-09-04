import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ParcelFeature, ParcelState } from '../lib/types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { MapPin } from '@phosphor-icons/react';

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
  SA: '#14532d'   // Dark green
};

function MapUpdater({ features }: { features: ParcelFeature[] }) {
  const map = useMap();
  
  useEffect(() => {
    if (features.length > 0) {
      const group = new L.FeatureGroup(
        features.map(feature => L.geoJSON(feature))
      );
      map.fitBounds(group.getBounds(), { padding: [20, 20] });
    } else {
      // Always show Australia when no features
      map.setView([-25.2744, 133.7751], 5);
    }
  }, [features, map]);
  
  return null;
}

export function MapView({ features, isLoading }: MapViewProps) {
  const [layerVisibility, setLayerVisibility] = useState<Record<ParcelState, boolean>>({
    NSW: true,
    QLD: true,
    SA: true
  });
  
  const mapRef = useRef<L.Map>(null);
  
  const getFeatureStyle = (feature: ParcelFeature) => {
    const state = feature.properties.state;
    const color = stateColors[state];
    const isVisible = layerVisibility[state];
    
    return {
      fillColor: color,
      fillOpacity: isVisible ? 0.3 : 0,
      color: color,
      weight: 2,
      opacity: isVisible ? 0.8 : 0
    };
  };
  
  const onEachFeature = (feature: ParcelFeature, layer: L.Layer) => {
    if (feature.properties) {
      const props = feature.properties;
      const popupContent = `
        <div style="font-family: Inter, sans-serif;">
          <h3 style="margin: 0 0 8px 0; color: #1f2937; font-size: 14px; font-weight: 600;">
            ${props.name || props.id}
          </h3>
          <div style="font-size: 12px; color: #6b7280; line-height: 1.4;">
            <div><strong>State:</strong> ${props.state}</div>
            <div><strong>ID:</strong> ${props.id}</div>
            ${props.area_ha ? `<div><strong>Area:</strong> ${props.area_ha.toFixed(2)} ha</div>` : ''}
            ${Object.entries(props)
              .filter(([key]) => !['id', 'state', 'name', 'area_ha'].includes(key))
              .slice(0, 3)
              .map(([key, value]) => `<div><strong>${key}:</strong> ${value}</div>`)
              .join('')
            }
          </div>
        </div>
      `;
      layer.bindPopup(popupContent);
    }
  };
  
  const visibleFeatures = features.filter(feature => 
    layerVisibility[feature.properties.state]
  );
  
  const stateStats = features.reduce((acc, feature) => {
    const state = feature.properties.state;
    acc[state] = (acc[state] || 0) + 1;
    return acc;
  }, {} as Record<ParcelState, number>);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            Map Preview
          </div>
          <div className="flex gap-2">
            {Object.entries(stateStats).map(([state, count]) => (
              <Badge key={state} variant="secondary" className="text-xs">
                {state}: {count}
              </Badge>
            ))}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 flex-1 flex flex-col">
        {features.length > 0 && (
          <div className="p-4 border-b space-y-3">
            <Label className="text-sm font-medium">Layer Visibility</Label>
            <div className="flex gap-4">
              {(['NSW', 'QLD', 'SA'] as ParcelState[]).map(state => (
                <div key={state} className="flex items-center space-x-2">
                  <Switch
                    id={`layer-${state}`}
                    checked={layerVisibility[state]}
                    onCheckedChange={(checked) => 
                      setLayerVisibility(prev => ({ ...prev, [state]: checked }))
                    }
                  />
                  <Label 
                    htmlFor={`layer-${state}`} 
                    className="text-sm cursor-pointer flex items-center gap-2"
                  >
                    <div 
                      className="w-3 h-3 rounded border" 
                      style={{ 
                        backgroundColor: stateColors[state],
                        opacity: layerVisibility[state] ? 0.3 : 0.1,
                        borderColor: stateColors[state]
                      }}
                    />
                    {state}
                    {stateStats[state] && (
                      <span className="text-xs text-muted-foreground">
                        ({stateStats[state]})
                      </span>
                    )}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="flex-1 relative">
          {isLoading && (
            <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10">
              <div className="text-center">
                <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2"></div>
                <p className="text-sm text-muted-foreground">Loading parcel data...</p>
              </div>
            </div>
          )}
          
          <MapContainer
            ref={mapRef}
            center={[-25.2744, 133.7751]} // Center of Australia
            zoom={5}
            style={{ height: '100%', width: '100%' }}
            className="z-0"
          >
            {/* Google Satellite imagery via public tile server */}
            <TileLayer
              attribution='Imagery &copy; Google, Map data &copy; OpenStreetMap contributors'
              url="https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
              maxZoom={20}
            />
            
            {/* Always include MapUpdater to handle centering */}
            <MapUpdater features={visibleFeatures} />
            
            {visibleFeatures.length > 0 && (
              <GeoJSON
                key={`features-${visibleFeatures.length}-${JSON.stringify(layerVisibility)}`}
                data={{
                  type: 'FeatureCollection',
                  features: visibleFeatures
                }}
                style={getFeatureStyle}
                onEachFeature={onEachFeature}
              />
            )}
          </MapContainer>
          
          {!isLoading && features.length === 0 && (
            <div className="absolute top-4 left-4 bg-black/60 text-white p-3 rounded-lg text-sm backdrop-blur-sm z-10 max-w-xs">
              <div className="flex items-center gap-2 mb-1">
                <MapPin className="w-4 h-4" />
                <span className="font-medium">Australia Satellite View</span>
              </div>
              <p className="text-xs opacity-90">Search parcels to overlay on this satellite map</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}