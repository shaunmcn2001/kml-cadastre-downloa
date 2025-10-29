import React, { useEffect, useMemo } from 'react';
import { GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { LandTypeFeatureCollection, LandTypeFeature } from '../lib/types';

interface LandTypeLayerProps {
  enabled: boolean;
  data: LandTypeFeatureCollection | null;
  fitOnUpdate?: boolean;
}

const PANE_NAME = 'landtype-layer';

function formatPopupContent(feature: LandTypeFeature): string {
  const props = feature.properties || {};
  const lines: string[] = [];
  const title = props.name || props.code || 'Land Type';
  lines.push(`<div class="font-semibold text-sm mb-1">${title}</div>`);
  lines.push('<div class="text-xs space-y-1">');
  lines.push(`<div><span class="font-medium">Code:</span> ${props.code ?? '—'}</div>`);
  if (props.lotplan) {
    lines.push(`<div><span class="font-medium">Lotplan:</span> ${props.lotplan}</div>`);
  }
  if (typeof props.area_ha === 'number') {
    lines.push(
      `<div><span class="font-medium">Area (ha):</span> ${props.area_ha.toFixed(2)}</div>`,
    );
  }
  if (props.source) {
    lines.push(`<div><span class="font-medium">Source:</span> ${props.source}</div>`);
  }
  lines.push('</div>');
  return lines.join('');
}

function applyFeatureStyle(feature: LandTypeFeature) {
  const props = feature.properties || {};
  const style = props.style || {};
  const alpha =
    typeof props.landtype_alpha === 'number'
      ? Math.min(Math.max(props.landtype_alpha, 0), 255) / 255
      : typeof style.fillOpacity === 'number'
      ? style.fillOpacity
      : 0.4;
  return {
    color: style.color ?? '#202020',
    weight: style.weight ?? 1.5,
    fillColor: style.fillColor ?? props.landtype_color ?? props.color_hex ?? '#009FDF',
    fillOpacity: alpha,
    opacity: style.opacity ?? 0.9,
  };
}

export const LandTypeLayer: React.FC<LandTypeLayerProps> = ({
  enabled,
  data,
  fitOnUpdate = true,
}) => {
  const map = useMap();

  useEffect(() => {
    if (!map.getPane(PANE_NAME)) {
      map.createPane(PANE_NAME);
    }
    const pane = map.getPane(PANE_NAME);
    if (pane) {
      pane.style.zIndex = '650';
    }
  }, [map]);

  const geoJsonData = useMemo(() => {
    if (!data || !data.features.length) {
      return null;
    }
    return data;
  }, [data]);

  useEffect(() => {
    if (!enabled || !fitOnUpdate || !geoJsonData) {
      return;
    }
    try {
      const group = L.geoJSON(geoJsonData as any);
      const bounds = group.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [24, 24] });
      }
    } catch (error) {
      console.warn('Unable to fit LandType layer bounds', error);
    }
  }, [enabled, fitOnUpdate, geoJsonData, map]);

  if (!enabled || !geoJsonData) {
    return null;
  }

  const handleEachFeature = (feature: any, layer: L.Layer) => {
    const typedFeature = feature as LandTypeFeature;
    if ('setStyle' in layer && typeof (layer as any).setStyle === 'function') {
      (layer as L.Path).setStyle(applyFeatureStyle(typedFeature));
    }

    const content = formatPopupContent(typedFeature);
    if (content) {
      (layer as L.Layer).bindPopup(content, {
        maxWidth: 320,
        className: 'landtype-popup',
      });
    }

    layer.on({
      mouseover: (event: L.LeafletMouseEvent) => {
        const target = event.target as L.Path;
        target.setStyle({
          weight: 2,
          fillOpacity: Math.min((applyFeatureStyle(typedFeature).fillOpacity ?? 0.4) + 0.15, 0.9),
        });
      },
      mouseout: (event: L.LeafletMouseEvent) => {
        const target = event.target as L.Path;
        target.setStyle(applyFeatureStyle(typedFeature));
      },
    });
  };

  return (
    <GeoJSON
      key={`landtype-${geoJsonData.features.length}`}
      pane={PANE_NAME}
      data={geoJsonData as any}
      onEachFeature={handleEachFeature}
    />
  );
};

LandTypeLayer.displayName = 'LandTypeLayer';
