import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api';
import type { ParcelFeature, PropertyReportResponse } from '@/lib/types';

interface PropertyReportExportPanelProps {
  report: PropertyReportResponse;
  visibleLayers: Record<string, boolean>;
}

function buildExportFeatures(report: PropertyReportResponse, visibleLayers: Record<string, boolean>): ParcelFeature[] {
  const features: ParcelFeature[] = [];

  const addFeature = (feature: any, fallbackName: string, layerColor?: string): void => {
    if (!feature?.geometry) return;
    const props = { ...(feature.properties || {}) };
    if (layerColor && !props.layer_color) {
      props.layer_color = layerColor;
    }
    const id = props.id || props.lotplan || props.code || fallbackName;
    const name = props.name || props.code || fallbackName;
    props.id = id;
    props.name = name;
    props.state = 'QLD';
    props.layer = props.layer || fallbackName;

    features.push({
      type: 'Feature',
      geometry: feature.geometry,
      properties: props,
    });
  };

  report.parcelFeatures.features.forEach((feature, index) => {
    addFeature(feature, `Parcel ${index + 1}`);
  });

  report.layers.forEach(layer => {
    if (visibleLayers[layer.id] === false) {
      return;
    }
    layer.featureCollection.features.forEach((feature, index) => {
      const fallback = `${layer.label} ${index + 1}`;
      const props = feature.properties || {};
      props.layer_label = layer.label;
      props.layer_id = layer.id;
      addFeature({ ...feature, properties: props }, fallback, layer.color);
    });
  });

  return features;
}

export function PropertyReportExportPanel({ report, visibleLayers }: PropertyReportExportPanelProps) {
  const [folderName, setFolderName] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  const features = useMemo(() => buildExportFeatures(report, visibleLayers), [report, visibleLayers]);

  const buildExportRequest = () => ({
    features,
    styleOptions: {
      fillOpacity: 0.4,
      strokeWidth: 2,
      colorByState: false,
      folderName: folderName.trim() || undefined,
      mergeByName: false,
      fillColor: '#2563eb',
      strokeColor: '#1f2937',
    }
  });

  const handleExport = async (format: 'kml' | 'kmz' | 'geotiff') => {
    if (!features.length) {
      toast.error('No features available to export');
      return;
    }

    setIsExporting(true);
    try {
      const request = buildExportRequest();
      const timestamp = new Date().toISOString().split('T')[0];
      const baseName = folderName.trim() || `property-report-${timestamp}`;

      let blob: Blob;
      if (format === 'kml') {
        blob = await apiClient.exportKML({ ...request, fileName: `${baseName}.kml` });
      } else if (format === 'kmz') {
        blob = await apiClient.exportKMZ({ ...request, fileName: `${baseName}.kmz` });
      } else {
        blob = await apiClient.exportGeoTIFF({ ...request, fileName: `${baseName}.tif` });
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = format === 'geotiff' ? `${baseName}.tif` : `${baseName}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${format.toUpperCase()} file`);
    } catch (error) {
      console.error('Export failed', error);
      toast.error(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Export Results</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="space-y-2">
          <Label htmlFor="report-folder-name" className="text-xs text-muted-foreground">
            Export Folder Name (optional)
          </Label>
          <Input
            id="report-folder-name"
            placeholder="e.g., SmithProperty"
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            className="h-8 text-xs"
          />
          <p className="text-[11px] text-muted-foreground/70">
            Used for KMZ/KML document naming. Leave blank for automatic naming.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <Button
            variant="outline"
            className="justify-start"
            disabled={isExporting}
            onClick={() => handleExport('kml')}
          >
            Download KML
          </Button>
          <Button
            variant="outline"
            className="justify-start"
            disabled={isExporting}
            onClick={() => handleExport('kmz')}
          >
            Download KMZ
          </Button>
          <Button
            variant="outline"
            className="justify-start"
            disabled={isExporting}
            onClick={() => handleExport('geotiff')}
          >
            Download GeoTIFF
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
