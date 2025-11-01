import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Download, Package, Image, WarningCircle, Folder, ArrowCircleDown, TextAa } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { apiClient } from '../lib/api';
import { cn } from '../lib/utils';
import { formatFolderName } from '../lib/formatters';
import type {
  ParcelFeature,
  LandTypeFeatureCollection,
  LandTypeExportFormat,
} from '../lib/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const COLOR_PRESETS = [
  { id: 'subjects', label: 'Subjects', value: '#009FDF' },
  { id: 'quotes', label: 'Quotes', value: '#A23F97' },
  { id: 'sales', label: 'Sales', value: '#FF0000' },
  { id: 'for-sales', label: 'For Sales', value: '#ED7D31' }
] as const;

const DEFAULT_COLOR = COLOR_PRESETS[1].value;
const LANDTYPE_FORMAT_EXTENSIONS: Record<LandTypeExportFormat, string> = {
  kml: '.kml',
  kmz: '.kmz',
  geojson: '.geojson',
  tiff: '.tif',
};

interface ExportPanelProps {
  features: ParcelFeature[];
  isQuerying: boolean;
  landTypeAvailable: boolean;
  landTypeEnabled: boolean;
  landTypeData: LandTypeFeatureCollection | null;
  landTypeIsLoading: boolean;
  showLandTypeExport?: boolean;
}

export function ExportPanel({
  features,
  isQuerying,
  landTypeAvailable,
  landTypeEnabled,
  landTypeData,
  landTypeIsLoading,
  showLandTypeExport = true,
}: ExportPanelProps) {
  const [exportingKML, setExportingKML] = React.useState(false);
  const [exportingKMZ, setExportingKMZ] = React.useState(false);
  const [exportingGeoTIFF, setExportingGeoTIFF] = React.useState(false);
  const [folderName, setFolderName] = React.useState('');
  const [selectedColor, setSelectedColor] = React.useState<string>(DEFAULT_COLOR);
  const [hexInputValue, setHexInputValue] = React.useState<string>(DEFAULT_COLOR);
  const [activePreset, setActivePreset] = React.useState<string | 'custom'>(DEFAULT_COLOR);
  const [landTypeFormat, setLandTypeFormat] = React.useState<LandTypeExportFormat>('kmz');
  const [landTypeColorMode, setLandTypeColorMode] = React.useState<'preset' | 'byProperty'>('preset');
  const [landTypePreset, setLandTypePreset] = React.useState<string>('subjects');
  const [landTypeAlpha, setLandTypeAlpha] = React.useState<number>(180);
  const [landTypePropertyKey, setLandTypePropertyKey] = React.useState<string>('');
  const [landTypeFilename, setLandTypeFilename] = React.useState<string>('');
  const [exportingLandType, setExportingLandType] = React.useState(false);

  const applyColor = React.useCallback((value: string, source: 'preset' | 'custom') => {
    const normalised = value.startsWith('#') ? value.toUpperCase() : `#${value.toUpperCase()}`;
    if (!/^#[0-9A-F]{6}$/.test(normalised)) {
      return;
    }
    setSelectedColor(normalised);
    setHexInputValue(normalised);
    setActivePreset(source === 'preset' ? normalised : 'custom');
  }, []);

  const handlePresetClick = React.useCallback((value: string) => {
    applyColor(value, 'preset');
  }, [applyColor]);

  const handleColorPickerChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    applyColor(event.target.value, 'custom');
  }, [applyColor]);

  const handleHexInputChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.target.value.toUpperCase();
    const normalised = rawValue.startsWith('#') ? rawValue : `#${rawValue}`;

    if (/^#[0-9A-F]{0,6}$/.test(normalised)) {
      setHexInputValue(normalised);
      if (normalised.length === 7 && /^#[0-9A-F]{6}$/.test(normalised)) {
        applyColor(normalised, 'custom');
      }
    }
  }, [applyColor]);

  const handleHexInputBlur = React.useCallback(() => {
    setHexInputValue(selectedColor);
  }, [selectedColor]);

  const hasFeatures = features.length > 0;
  const totalArea = features.reduce((sum, f) => sum + (f.properties.area_ha || 0), 0);
  const landTypeSectionVisible = showLandTypeExport && landTypeAvailable;
  const landTypeFeatureCount = landTypeData?.features?.length ?? 0;
  const landTypeHasData = landTypeFeatureCount > 0;
  const landTypeWarningsCombined = landTypeData?.properties?.warnings ?? [];
  const landTypeMode = landTypeData?.properties?.mode ?? null;

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
      
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `cadastral-parcels-${features.length}-${timestamp}.kml`;

      const blob = await apiClient.exportKML({
        features,
        fileName: filename,
        styleOptions: {
          fillOpacity: 0.4,
          strokeWidth: 3,
          colorByState: false,
          folderName: folderName.trim() || undefined,
          fillColor: selectedColor,
          strokeColor: selectedColor,
          mergeByName: false
        }
      });

      console.log('KML blob received:', { size: blob.size, type: blob.type });

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
      
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `cadastral-parcels-${features.length}-${timestamp}.kmz`;

      const blob = await apiClient.exportKMZ({
        features,
        fileName: filename,
        styleOptions: {
          fillOpacity: 0.4,
          strokeWidth: 3,
          colorByState: false,
          folderName: folderName.trim() || undefined,
          fillColor: selectedColor,
          strokeColor: selectedColor,
          mergeByName: false
        }
      });

      console.log('KMZ blob received:', { size: blob.size, type: blob.type });

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

  const handleLandTypeExport = async () => {
    if (!landTypeSectionVisible) {
      toast.error('LandType exports are not enabled in this environment.');
      return;
    }
    if (!landTypeEnabled) {
      toast.warning('Enable the LandType overlay on the map before exporting.');
      return;
    }
    if (!landTypeHasData || !landTypeData) {
      toast.warning('Load LandType polygons on the map before exporting.');
      return;
    }

    if (landTypeColorMode === 'byProperty' && !landTypePropertyKey.trim()) {
      toast.error('Provide a property field name when colouring by property.');
      return;
    }

    setExportingLandType(true);
    try {
      const alpha = Math.max(0, Math.min(255, Number(landTypeAlpha) || 0));

      const response = await apiClient.exportLandType({
        features: landTypeData,
        format: landTypeFormat,
        styleOptions: {
          colorMode: landTypeColorMode,
          presetName: landTypeColorMode === 'preset' ? landTypePreset : undefined,
          propertyKey: landTypeColorMode === 'byProperty' ? landTypePropertyKey.trim() || undefined : undefined,
          alpha,
        },
        filenameTemplate: landTypeFilename.trim() || undefined,
      });

      const fallbackName = `landtype-export${LANDTYPE_FORMAT_EXTENSIONS[landTypeFormat]}`;
      const downloadName = response.filename || fallbackName;
      const success = downloadFile(response.blob, downloadName);

      if (success) {
        toast.success(`LandType ${landTypeFormat.toUpperCase()} downloaded successfully`);
      } else {
        toast.error('Failed to start LandType download. Check pop-up blockers or browser settings.');
      }
    } catch (error) {
      console.error('LandType export failed:', error);
      toast.error(
        `LandType export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      setExportingLandType(false);
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
              Export Folder Name (Address)
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="folder-name"
                type="text"
                placeholder="e.g., 123 Sample Street"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                className="text-sm flex-1"
                maxLength={100}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setFolderName((prev) => formatFolderName(prev))}
                disabled={!folderName.trim()}
                className="flex items-center gap-1 shrink-0"
              >
                <TextAa className="w-4 h-4" />
                Format
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Used for the KMZ folder and KML document name. Leave empty for default naming.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Polygon Colour</Label>
            <div className="flex flex-wrap gap-4">
              {COLOR_PRESETS.map(preset => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => handlePresetClick(preset.value)}
                  className={cn(
                    'flex flex-col items-center gap-1 text-xs transition-colors',
                    activePreset === preset.value ? 'text-foreground font-medium' : 'text-muted-foreground'
                  )}
                >
                  <span
                    className={cn(
                      'h-9 w-9 rounded-full border border-border shadow-sm transition-all',
                      activePreset === preset.value ? 'ring-2 ring-offset-2 ring-primary' : ''
                    )}
                    style={{ backgroundColor: preset.value }}
                    aria-hidden
                  />
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="color"
                value={selectedColor}
                onChange={handleColorPickerChange}
                className="h-10 w-16 cursor-pointer rounded border border-input bg-background p-1"
                aria-label="Choose custom polygon colour"
              />
              <Input
                value={hexInputValue}
                onChange={handleHexInputChange}
                onBlur={handleHexInputBlur}
                maxLength={7}
                className="w-28 font-mono text-sm uppercase"
                aria-label="Polygon colour hex code"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => applyColor(DEFAULT_COLOR, 'preset')}
                disabled={selectedColor === DEFAULT_COLOR}
              >
                Reset
              </Button>
            </div>
          </div>

          <Separator />
          
          {/* Test download button for troubleshooting */}
          {hasFeatures && (
            <Button
              onClick={() => {
                try {
                  const testContent = `Test download from Praedia\nTimestamp: ${new Date().toISOString()}\nFeatures loaded: ${features.length}`;
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

          {landTypeSectionVisible && (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <ArrowCircleDown className="w-4 h-4 text-primary" />
                      LandType Export
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {landTypeEnabled
                        ? landTypeHasData
                          ? `${landTypeFeatureCount} polygon${landTypeFeatureCount === 1 ? '' : 's'} ready from ${
                              landTypeMode === 'bbox' ? 'map extent' : 'QLD lotplans'
                            }.`
                          : landTypeIsLoading
                          ? 'LandType polygons loading…'
                          : 'No LandType polygons loaded yet – refresh from the map controls.'
                        : 'Enable the LandType overlay in the map to prepare polygons for export.'}
                    </p>
                  </div>
                  {landTypeMode && (
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                      {landTypeMode === 'bbox' ? 'Map Extent' : 'Lotplans'}
                    </Badge>
                  )}
                </div>

                {landTypeWarningsCombined.map((warning, index) => (
                  <div
                    key={`landtype-warning-${index}`}
                    className="flex items-start gap-2 text-[11px] text-amber-600"
                  >
                    <WarningCircle className="w-4 h-4 mt-0.5" />
                    <span>{warning}</span>
                  </div>
                ))}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Format</Label>
                    <Select
                      value={landTypeFormat}
                      onValueChange={(value) =>
                        setLandTypeFormat(value as LandTypeExportFormat)
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="text-xs">
                        <SelectItem value="kmz">KMZ (Google Earth Pro)</SelectItem>
                        <SelectItem value="kml">KML (Google Earth Web)</SelectItem>
                        <SelectItem value="geojson">GeoJSON</SelectItem>
                        <SelectItem value="tiff">GeoTIFF</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Colour Strategy</Label>
                    <Select
                      value={landTypeColorMode}
                      onValueChange={(value) =>
                        setLandTypeColorMode(value as 'preset' | 'byProperty')
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="text-xs">
                        <SelectItem value="preset">Preset palette</SelectItem>
                        <SelectItem value="byProperty">By property field</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {landTypeColorMode === 'preset' && (
                  <div className="flex flex-wrap gap-4">
                    {COLOR_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setLandTypePreset(preset.id)}
                        className={cn(
                          'flex flex-col items-center gap-1 text-[11px] transition-colors',
                          landTypePreset === preset.id
                            ? 'text-foreground font-medium'
                            : 'text-muted-foreground',
                        )}
                      >
                        <span
                          className={cn(
                            'h-8 w-8 rounded-full border border-border shadow-sm transition-all',
                            landTypePreset === preset.id ? 'ring-2 ring-offset-2 ring-primary' : '',
                          )}
                          style={{ backgroundColor: preset.value }}
                          aria-hidden
                        />
                        <span>{preset.label}</span>
                      </button>
                    ))}
                  </div>
                )}

                {landTypeColorMode === 'byProperty' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="landtype-property" className="text-xs font-medium">
                      Property field for colours
                    </Label>
                    <Input
                      id="landtype-property"
                      placeholder="e.g. lt_category"
                      value={landTypePropertyKey}
                      onChange={(event) => setLandTypePropertyKey(event.target.value)}
                      className="text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Uses deterministic colours derived from each feature&apos;s property value.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="landtype-alpha" className="text-xs font-medium">
                      Fill opacity (0-255)
                    </Label>
                    <Input
                      id="landtype-alpha"
                      type="number"
                      min={0}
                      max={255}
                      value={landTypeAlpha}
                      onChange={(event) => setLandTypeAlpha(Number(event.target.value))}
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="landtype-filename" className="text-xs font-medium">
                      Filename template
                    </Label>
                    <Input
                      id="landtype-filename"
                      placeholder="Optional base name"
                      value={landTypeFilename}
                      onChange={(event) => setLandTypeFilename(event.target.value)}
                      className="text-sm"
                      maxLength={100}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Template applied before extension; leave blank to auto-name.
                    </p>
                  </div>
                </div>

                <Button
                  onClick={handleLandTypeExport}
                  disabled={
                    !landTypeEnabled || !landTypeHasData || exportingLandType || landTypeIsLoading
                  }
                  className="w-full justify-start"
                  variant="outline"
                >
                  <ArrowCircleDown className="w-4 h-4 mr-2" />
                  {exportingLandType
                    ? 'Generating LandType…'
                    : `Download LandType ${landTypeFormat.toUpperCase()}`}
                </Button>
              </div>
            </>
          )}
        </div>

        {!hasFeatures && !isQuerying && (
          <div className="text-center py-6 text-muted-foreground">
            <WarningCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
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
        </div>
      </CardContent>
    </Card>
  );
}
