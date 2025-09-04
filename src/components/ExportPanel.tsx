import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Download, Package, Image, AlertTriangle, Folder } from '@phosphor-icons/react';
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
  const [folderName, setFolderName] = React.useState('');

  const hasFeatures = features.length > 0;
  const totalArea = features.reduce((sum, f) => sum + (f.properties.area_ha || 0), 0);

  const downloadFile = (blob: Blob, filename: string) => {
    try {
      console.log('Attempting download:', { filename, blobSize: blob.size, blobType: blob.type });
      
      // Check if blob is valid
      if (!blob || blob.size === 0) {
        console.error('Invalid blob:', blob);
        throw new Error('Received empty or invalid file data from server');
      }
      
      // Create blob URL
      const url = URL.createObjectURL(blob);
      
      // Method 1: Try modern download with proper MIME type
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      
      // Set proper MIME type for Google Earth compatibility
      if (filename.toLowerCase().endsWith('.kml')) {
        link.type = 'application/vnd.google-earth.kml+xml';
      } else if (filename.toLowerCase().endsWith('.kmz')) {
        link.type = 'application/vnd.google-earth.kmz';
      }
      
      // Add to DOM and trigger click
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up URL
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      
      console.log('Download initiated successfully');
      return true;
      
    } catch (error) {
      console.error('Primary download method failed:', error);
      
      // Method 2: Alternative approach using window.location
      try {
        const url = URL.createObjectURL(blob);
        const filename_encoded = encodeURIComponent(filename);
        const downloadUrl = `${url}#${filename_encoded}`;
        
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename;
        link.click();
        
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        console.log('Fallback download method succeeded');
        return true;
      } catch (fallbackError) {
        console.error('Fallback download failed:', fallbackError);
        
        // Method 3: Open in new window as last resort
        try {
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank');
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          console.log('Opened file in new window');
          return true;
        } catch (windowError) {
          console.error('All download methods failed:', windowError);
          return false;
        }
      }
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
          colorByState: true,
          googleEarthOptimized: true, // Enable Google Earth Web/Pro compatibility
          version: '2.3', // Use latest KML version
          folderName: folderName.trim() || undefined
        }
      });
      
      console.log('KML blob received:', { size: blob.size, type: blob.type });
      
      // Generate filename with parcel count and timestamp
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `cadastral-parcels-${features.length}-${timestamp}.kml`;
      
      const success = downloadFile(blob, filename);
      if (success) {
        toast.success(`KML downloaded successfully! Open in Google Earth Web or Google Earth Pro.`);
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
          colorByState: true,
          googleEarthOptimized: true, // Enable Google Earth Web/Pro compatibility
          version: '2.3', // Use latest KML version
          folderName: folderName.trim() || undefined
        }
      });
      
      console.log('KMZ blob received:', { size: blob.size, type: blob.type });
      
      // Generate filename with parcel count and timestamp
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `cadastral-parcels-${features.length}-${timestamp}.kmz`;
      
      const success = downloadFile(blob, filename);
      if (success) {
        toast.success(`KMZ downloaded successfully! Open in Google Earth Pro for best results.`);
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
          <div className="space-y-2">
            <Label htmlFor="folder-name" className="text-sm font-medium flex items-center gap-2">
              <Folder className="w-4 h-4" />
              KML Folder Name (Optional)
            </Label>
            <Input
              id="folder-name"
              type="text"
              placeholder="e.g., My Parcels"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              className="text-sm"
              maxLength={100}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty for default folder name
            </p>
          </div>

          <Separator />
          
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
            {exportingKML ? 'Generating KML...' : 'Download KML (Google Earth)'}
          </Button>

          <Button
            onClick={handleExportKMZ}
            disabled={!hasFeatures || exportingKMZ || isQuerying}
            className="w-full justify-start"
            variant="outline"
          >
            <Package className="w-4 h-4 mr-2" />
            {exportingKMZ ? 'Generating KMZ...' : 'Download KMZ (Google Earth Pro)'}
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
          <p><strong>KML:</strong> For Google Earth Web & Pro, compatible with latest version</p>
          <p><strong>KMZ:</strong> Compressed KML with enhanced styling for Google Earth</p>
          <p><strong>GeoTIFF:</strong> Raster format for advanced GIS analysis</p>
          <p className="text-accent font-medium mt-2">✓ Optimized for Google Earth 9.x and Google Earth Web</p>
        </div>
      </CardContent>
    </Card>
  );
}