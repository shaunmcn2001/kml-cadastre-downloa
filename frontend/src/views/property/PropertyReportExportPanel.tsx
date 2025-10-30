import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api';
import type { PropertyReportResponse } from '@/lib/types';

interface PropertyReportExportPanelProps {
  report: PropertyReportResponse;
  visibleLayers: Record<string, boolean>;
}

export function PropertyReportExportPanel({ report, visibleLayers }: PropertyReportExportPanelProps) {
  const [folderName, setFolderName] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const exportableCount = useMemo(() => {
    if (!report) return 0;
    const parcelCount = report.parcelFeatures?.features?.length ?? 0;
    const datasetCount = report.layers.reduce((sum, layer) => {
      if (visibleLayers[layer.id] === false) {
        return sum;
      }
      const featuresInLayer = layer.featureCollection?.features?.length ?? 0;
      return sum + featuresInLayer;
    }, 0);
    return parcelCount + datasetCount;
  }, [report, visibleLayers]);

  const hasExportableData = exportableCount > 0;

  const handleExport = async (format: 'kml' | 'kmz' | 'geojson') => {
    if (!hasExportableData) {
      toast.error('No features available to export');
      return;
    }

    setIsExporting(true);
    try {
      const timestamp = new Date().toISOString().split('T')[0];
      const baseName = folderName.trim() || `property-report-${timestamp}`;

      const payload = {
        report,
        format,
        visibleLayers,
        options: {
          includeParcels: true,
          folderName: folderName.trim() || undefined,
        },
      };

      let blob: Blob;
      blob = await apiClient.exportPropertyReport(payload);

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const extension = format === 'geojson' ? 'geojson' : format;
      link.download = `${baseName}.${extension}`;
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
            onClick={() => handleExport('geojson')}
          >
            Download GeoJSON
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
