import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Download, Package, Image, AlertTriangle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { apiClient } from '../lib/api';
import type { ParcelFeature } from '../lib/types';

interface ExportPanelProps {
  features: ParcelFeature[];
  isQuerying: boolean;
}

export function ExportPanel({ features, isQuerying }: ExportPanelProps) {
  const [exportingKML, setExportingKML] = React.useState(false);
  const [exportingKMZ, setExportingKMZ] = React.useState(false);
  const [exportingGeoTIFF, setExportingGeoTIFF] = React.useState(false);

  const hasFeatures = features.length > 0;
  const totalArea = features.reduce((sum, f) => sum + (f.properties.area_ha || 0), 0);

  const downloadFile = (blob: Blob, filename: string) => {
    try {
      console.log('Attempting download:', { filename, blobSize: blob.size, blobType: blob.type });
      
      // Check if blob is valid
      if (!blob || blob.size === 0) {
        console.error('Invalid blob:', blob);
        throw new Error('Received empty or invalid file data');
      }
      
      // Try modern download approach first
      if (window.navigator && (window.navigator as any).msSaveBlob) {
        // IE/Edge fallback
        console.log('Using IE/Edge download method');
        (window.navigator as any).msSaveBlob(blob, filename);
        return true;
      }
      
      // Create a temporary URL for the blob
      const url = URL.createObjectURL(blob);
      console.log('Created blob URL:', url);
      
      // Create a temporary download link
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      
      // Try to trigger download
      document.body.appendChild(link);
      
      // For some browsers, we need to trigger a click event
      if (document.createEvent) {
        const event = document.createEvent('MouseEvents');
        event.initEvent('click', true, true);
        link.dispatchEvent(event);
      } else {
        link.click();
      }
      
      document.body.removeChild(link);
      console.log('Download initiated successfully');
      
      // Clean up the object URL after a short delay
      setTimeout(() => {
        URL.revokeObjectURL(url);
        console.log('Blob URL cleaned up');
      }, 1000);
      
      return true;
    } catch (error) {
      console.error('Download failed:', error);
      
      // Fallback: try opening blob in new window
      try {
        console.log('Trying fallback: opening in new window');
        const url = URL.createObjectURL(blob);
        const newWindow = window.open(url, '_blank');
        if (newWindow) {
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          return true;
        }
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError);
      }
      
      return false;
    }
  };

  const handleExportKML = async () => {
    if (!hasFeatures) return;
    
    setExportingKML(true);
    try {
      console.log('Starting KML export for', features.length, 'features');
      
      const blob = await apiClient.exportKML({
        features,
        styleOptions: {
          fillOpacity: 0.3,
          strokeWidth: 2,
          colorByState: true
        }
      });
      
      console.log('KML blob received:', blob);
      
      // Generate filename with parcel count and timestamp
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `cadastral-parcels-${features.length}-${timestamp}.kml`;
      
      const success = downloadFile(blob, filename);
      if (success) {
        toast.success(`KML file downloaded: ${filename}`);
      } else {
        toast.error('Download failed - please check your browser settings allow downloads from this site');
      }
    } catch (error) {
      console.error('KML export failed:', error);
      toast.error(`KML export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setExportingKML(false);
    }
  };

  const handleExportKMZ = async () => {
    if (!hasFeatures) return;
    
    setExportingKMZ(true);
    try {
      console.log('Starting KMZ export for', features.length, 'features');
      
      const blob = await apiClient.exportKMZ({
        features,
        styleOptions: {
          fillOpacity: 0.3,
          strokeWidth: 2,
          colorByState: true
        }
      });
      
      console.log('KMZ blob received:', blob);
      
      // Generate filename with parcel count and timestamp
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `cadastral-parcels-${features.length}-${timestamp}.kmz`;
      
      const success = downloadFile(blob, filename);
      if (success) {
        toast.success(`KMZ file downloaded: ${filename}`);
      } else {
        toast.error('Download failed - please check your browser settings allow downloads from this site');
      }
    } catch (error) {
      console.error('KMZ export failed:', error);
      toast.error(`KMZ export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setExportingKMZ(false);
    }
  };

  const handleExportGeoTIFF = async () => {
    if (!hasFeatures) return;
    
    setExportingGeoTIFF(true);
    try {
      console.log('Starting GeoTIFF export for', features.length, 'features');
      
      const blob = await apiClient.exportGeoTIFF({
        features,
        styleOptions: {
          fillOpacity: 1.0,
          colorByState: true
        }
      });
      
      console.log('GeoTIFF blob received:', blob);
      
      // Generate filename with parcel count and timestamp
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `cadastral-parcels-${features.length}-${timestamp}.tif`;
      
      const success = downloadFile(blob, filename);
      if (success) {
        toast.success(`GeoTIFF file downloaded: ${filename}`);
      } else {
        toast.error('Download failed - please check your browser settings allow downloads from this site');
      }
    } catch (error) {
      console.error('GeoTIFF export failed:', error);
      toast.error(`GeoTIFF export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setExportingGeoTIFF(false);
    }
  };

  const stateBreakdown = features.reduce((acc, feature) => {
    const state = feature.properties.state;
    acc[state] = (acc[state] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="w-5 h-5 text-primary" />
          Export Data
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasFeatures && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <Label className="text-muted-foreground">Total Parcels</Label>
                <div className="font-semibold">{features.length}</div>
              </div>
              <div>
                <Label className="text-muted-foreground">Total Area</Label>
                <div className="font-semibold">{totalArea.toFixed(2)} ha</div>
              </div>
            </div>
            
            <div>
              <Label className="text-muted-foreground text-sm">By State</Label>
              <div className="flex gap-2 mt-1">
                {Object.entries(stateBreakdown).map(([state, count]) => (
                  <Badge key={state} variant="secondary">
                    {state}: {count}
                  </Badge>
                ))}
              </div>
            </div>
            
            <Separator />
          </div>
        )}

        <div className="space-y-3">
          {/* Test download button for troubleshooting */}
          {hasFeatures && (
            <Button
              onClick={() => {
                try {
                  const testContent = `Test download from KML Downloads app\nTimestamp: ${new Date().toISOString()}\nFeatures loaded: ${features.length}`;
                  const testBlob = new Blob([testContent], { type: 'text/plain' });
                  const success = downloadFile(testBlob, 'download-test.txt');
                  if (success) {
                    toast.success('Test download successful! Your browser settings are working correctly.');
                  } else {
                    toast.error('Test download failed - please check your browser download settings.');
                  }
                } catch (error) {
                  console.error('Test download failed:', error);
                  toast.error('Test download failed - browser may be blocking downloads.');
                }
              }}
              className="w-full justify-start text-xs"
              variant="ghost"
              size="sm"
            >
              Test Download (Troubleshooting)
            </Button>
          )}
          
          <Button
            onClick={handleExportKML}
            disabled={!hasFeatures || exportingKML || isQuerying}
            className="w-full justify-start"
            variant="outline"
          >
            <Package className="w-4 h-4 mr-2" />
            {exportingKML ? 'Generating KML...' : 'Download KML'}
          </Button>

          <Button
            onClick={handleExportKMZ}
            disabled={!hasFeatures || exportingKMZ || isQuerying}
            className="w-full justify-start"
            variant="outline"
          >
            <Package className="w-4 h-4 mr-2" />
            {exportingKMZ ? 'Generating KMZ...' : 'Download KMZ'}
          </Button>

          <Button
            onClick={handleExportGeoTIFF}
            disabled={!hasFeatures || exportingGeoTIFF || isQuerying}
            className="w-full justify-start"
            variant="outline"
          >
            <Image className="w-4 h-4 mr-2" />
            {exportingGeoTIFF ? 'Generating GeoTIFF...' : 'Download GeoTIFF (Beta)'}
          </Button>
        </div>

        {!hasFeatures && !isQuerying && (
          <div className="text-center py-6 text-muted-foreground">
            <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No data to export</p>
            <p className="text-xs mt-1">Query parcels first to enable downloads</p>
          </div>
        )}

        {isQuerying && (
          <div className="text-center py-6 text-muted-foreground">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2"></div>
            <p className="text-sm">Preparing export data...</p>
          </div>
        )}

        <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
          <p><strong>KML:</strong> For Google Earth, basic GIS software</p>
          <p><strong>KMZ:</strong> Compressed KML with styling</p>
          <p><strong>GeoTIFF:</strong> Raster format for advanced GIS analysis</p>
        </div>
      </CardContent>
    </Card>
  );
}