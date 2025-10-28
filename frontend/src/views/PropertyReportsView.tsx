import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { PropertyReportMap } from '@/components/PropertyReportMap';
import { apiClient } from '@/lib/api';
import { parseQLD } from '@/lib/parsers';
import type {
  ParcelFeature,
  PropertyLayerMeta,
  PropertyReportLayerResult,
  PropertyReportResponse,
} from '@/lib/types';
import { PropertyReportExportPanel } from './property/PropertyReportExportPanel';

interface ParsedLotPlanState {
  valid: string[];
  malformed: { raw: string; error: string }[];
}

const initialParsedState: ParsedLotPlanState = { valid: [], malformed: [] };

export function PropertyReportsView() {
  const [datasets, setDatasets] = useState<PropertyLayerMeta[]>([]);
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<string[]>([]);
  const [lotPlanInput, setLotPlanInput] = useState('');
  const [parsedState, setParsedState] = useState<ParsedLotPlanState>(initialParsedState);
  const [isQuerying, setIsQuerying] = useState(false);
  const [report, setReport] = useState<PropertyReportResponse | null>(null);
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({});
  const [selectAll, setSelectAll] = useState(false);

  useEffect(() => {
    const fetchLayers = async () => {
      try {
        const layers = await apiClient.listPropertyLayers();
        setDatasets(layers);
      } catch (error) {
        console.error('Failed to load dataset metadata', error);
        toast.error('Unable to load property datasets');
      }
    };
    fetchLayers();
  }, []);

  useEffect(() => {
    if (!lotPlanInput.trim()) {
      setParsedState(initialParsedState);
      return;
    }

    const lines = lotPlanInput.split(/\r?\n|,|;/).map(line => line.trim()).filter(Boolean);
    const results = lines.map(line => parseQLD(line));

    const valid = results.flatMap(result => result.valid.map(entry => entry.id));
    const malformed = results.flatMap(result => result.malformed);

    setParsedState({ valid, malformed });
  }, [lotPlanInput]);

  const handleDatasetToggle = (id: string) => {
    setSelectedDatasetIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
    setSelectAll(false);
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) {
      setSelectedDatasetIds(datasets.map(dataset => dataset.id));
    } else {
      setSelectedDatasetIds([]);
    }
  };

  const handleQuery = async () => {
    if (!parsedState.valid.length) {
      toast.error('Enter at least one valid QLD lot/plan');
      return;
    }
    if (!selectAll && selectedDatasetIds.length === 0) {
      toast.error('Select at least one dataset');
      return;
    }

    setIsQuerying(true);
    try {
      const response = await apiClient.queryPropertyReport({
        lotPlans: parsedState.valid,
        layers: selectAll ? ['all'] : selectedDatasetIds,
      });
      setReport(response);
      const visibility: Record<string, boolean> = {};
      response.layers.forEach(layer => {
        visibility[layer.id] = true;
      });
      setLayerVisibility(visibility);
      toast.success(`Loaded ${response.layers.reduce((sum, layer) => sum + layer.featureCount, 0)} dataset feature(s)`);
    } catch (error) {
      console.error('Property report query failed', error);
      toast.error(error instanceof Error ? error.message : 'Failed to query property datasets');
      setReport(null);
    } finally {
      setIsQuerying(false);
    }
  };

  const parcelFeatures = useMemo<ParcelFeature[] | undefined>(() => {
    if (!report?.parcelFeatures?.features) return undefined;
    return report.parcelFeatures.features as ParcelFeature[];
  }, [report]);

  const layerResults: PropertyReportLayerResult[] = report?.layers ?? [];

  const handleLayerVisibilityToggle = (layerId: string) => {
    setLayerVisibility(prev => ({
      ...prev,
      [layerId]: prev[layerId] === false ? true : false,
    }));
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 p-4">
        <PropertyReportMap
          parcels={parcelFeatures}
          layers={layerResults}
          layerVisibility={layerVisibility}
          onToggleLayer={handleLayerVisibilityToggle}
        />
      </div>

      <div className="w-96 border-l bg-card flex flex-col max-h-full">
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="p-4 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Lot / Plan Selection</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="space-y-2">
                  <Label htmlFor="lot-plan-input" className="text-xs font-medium text-muted-foreground">
                    Queensland Lot / Plan (one per line)
                  </Label>
                  <Textarea
                    id="lot-plan-input"
                    placeholder={`e.g.\n27 PS433970\nLot 14 RP123456`}
                    value={lotPlanInput}
                    onChange={(event) => setLotPlanInput(event.target.value)}
                    className="min-h-[140px] text-xs font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground/70">
                    Formats like <code>27\PS433970</code>, <code>27 PS433970</code>, or <code>Lot 27 RP12345</code> are accepted.
                  </p>
                </div>

                {parsedState.valid.length > 0 && (
                  <div className="bg-primary/5 rounded-md p-3 text-xs flex items-center justify-between">
                    <span className="text-primary font-medium">{parsedState.valid.length} valid lot/plan entr{parsedState.valid.length === 1 ? 'y' : 'ies'}</span>
                    <Badge variant="secondary" className="text-xs px-1.5 py-0">QLD</Badge>
                  </div>
                )}

                {parsedState.malformed.length > 0 && (
                  <div className="bg-destructive/10 rounded-md p-3 text-xs space-y-1 text-destructive">
                    <p className="font-medium">Malformed entries</p>
                    {parsedState.malformed.slice(0, 5).map((item, idx) => (
                      <p key={idx} className="font-mono">{item.raw}: {item.error}</p>
                    ))}
                    {parsedState.malformed.length > 5 && (
                      <p className="italic">+{parsedState.malformed.length - 5} more…</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Datasets</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <Checkbox id="select-all-datasets" checked={selectAll} onCheckedChange={(checked) => handleSelectAll(Boolean(checked))} />
                  <Label htmlFor="select-all-datasets" className="text-xs">Select all datasets</Label>
                </div>

                <div className="space-y-2">
                  {datasets.map(dataset => (
                    <div key={dataset.id} className="flex items-start gap-2">
                      <Checkbox
                        id={`dataset-${dataset.id}`}
                        checked={selectAll || selectedDatasetIds.includes(dataset.id)}
                        onCheckedChange={() => handleDatasetToggle(dataset.id)}
                        disabled={selectAll}
                      />
                      <Label htmlFor={`dataset-${dataset.id}`} className="text-xs leading-tight cursor-pointer space-y-1">
                        <span className="font-medium text-foreground flex items-center gap-1">
                          {dataset.label}
                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                            {dataset.geometryType}
                          </Badge>
                        </span>
                        {dataset.description && (
                          <span className="block text-muted-foreground/80">{dataset.description}</span>
                        )}
                      </Label>
                    </div>
                  ))}

                  {datasets.length === 0 && (
                    <p className="text-xs text-muted-foreground">Loading dataset catalogue…</p>
                  )}
                </div>

                <Button onClick={handleQuery} disabled={isQuerying} className="w-full">
                  {isQuerying ? 'Querying datasets…' : 'Query Selected Datasets'}
                </Button>
              </CardContent>
            </Card>

            {report && (
              <PropertyReportExportPanel
                report={report}
                visibleLayers={layerVisibility}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
