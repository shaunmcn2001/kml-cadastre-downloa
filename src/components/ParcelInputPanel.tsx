import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Database, AlertTriangle, CheckCircle } from '@phosphor-icons/react';
import { useParcelInput } from '../hooks/useParcelInput';
import type { ParcelState } from '../lib/types';

interface ParcelInputPanelProps {
  onQueryParcels: (parcelIds: string[], states: ParcelState[]) => void;
  isQuerying: boolean;
}

export function ParcelInputPanel({ onQueryParcels, isQuerying }: ParcelInputPanelProps) {
  const { inputState, updateRawInput, updateSelectedState, clearInput } = useParcelInput();
  const [hasAttemptedQuery, setHasAttemptedQuery] = useState(false);

  const handleQuery = () => {
    if (inputState.isValid) {
      const parcelIds = inputState.validParcels.map(p => p.id);
      const states = [inputState.selectedState];
      onQueryParcels(parcelIds, states);
      setHasAttemptedQuery(true);
    }
  };

  const exampleTexts = {
    NSW: `1//DP131118
2//DP131118
LOT 13 DP1242624
1-3//DP555123
101/1//DP12345`,
    QLD: `1RP912949
13SP12345
245GTP4567
1SL123456`,
    SA: `101//D12345
102//F23456
1/234//CT5678
15//DP789012`
  };

  return (
    <div className="h-full flex flex-col space-y-3">
      <div className="flex-shrink-0">
        <div className="flex items-center gap-2 mb-3">
          <Database className="w-4 h-4 text-primary" />
          <span className="font-medium text-sm">Parcel Input</span>
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-hidden">
        <div className="flex-shrink-0">
          <Label htmlFor="state-select" className="text-sm font-medium">
            Select State
          </Label>
          <Tabs 
            value={inputState.selectedState} 
            onValueChange={(value) => updateSelectedState(value as ParcelState)}
            className="w-full mt-2"
          >
            <TabsList className="grid w-full grid-cols-3 text-xs h-8">
              <TabsTrigger value="NSW" className="text-xs">NSW</TabsTrigger>
              <TabsTrigger value="QLD" className="text-xs">QLD</TabsTrigger>
              <TabsTrigger value="SA" className="text-xs">SA</TabsTrigger>
            </TabsList>
            
            <TabsContent value="NSW" className="space-y-3 mt-4">
              <div className="text-sm text-muted-foreground">
                <p className="font-medium mb-2">NSW Format Examples:</p>
                <div className="bg-muted p-2 rounded text-xs font-mono">
                  {exampleTexts.NSW}
                </div>
                <p className="mt-2 text-xs">
                  Supports: LOT//PLAN, LOT/SECTION//PLAN, ranges (1-3//DP123), and "LOT 13 DP1242624" format
                </p>
              </div>
            </TabsContent>
            
            <TabsContent value="QLD" className="space-y-3 mt-4">
              <div className="text-sm text-muted-foreground">
                <p className="font-medium mb-2">QLD Format Examples:</p>
                <div className="bg-muted p-2 rounded text-xs font-mono">
                  {exampleTexts.QLD}
                </div>
                <p className="mt-2 text-xs">
                  Supports: lotidstring format (numbers + letters + numbers)
                </p>
              </div>
            </TabsContent>
            
            <TabsContent value="SA" className="space-y-3 mt-4">
              <div className="text-sm text-muted-foreground">
                <p className="font-medium mb-2">SA Format Examples:</p>
                <div className="bg-muted p-2 rounded text-xs font-mono">
                  {exampleTexts.SA}
                </div>
                <p className="mt-2 text-xs">
                  Supports: PARCEL//PLAN and VOLUME/FOLIO//PLAN formats
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <div>
          <Label htmlFor="parcel-input" className="text-sm font-medium">
            Parcel Identifiers
          </Label>
          <Textarea
            id="parcel-input"
            placeholder={`Enter ${inputState.selectedState} parcel identifiers (one per line)...`}
            value={inputState.rawInput}
            onChange={(e) => updateRawInput(e.target.value)}
            className="mt-2 min-h-20 max-h-24 font-mono text-sm resize-none overflow-hidden"
          />
        </div>

        {inputState.rawInput && (
          <div className="space-y-3">
            {inputState.validParcels.length > 0 && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="flex items-center justify-between">
                    <span>
                      Parsed <strong>{inputState.validParcels.length}</strong> valid parcel(s)
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {inputState.selectedState}
                    </Badge>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {inputState.malformedEntries.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-2">
                    <p><strong>{inputState.malformedEntries.length}</strong> malformed entries:</p>
                    <div className="max-h-24 overflow-hidden text-xs space-y-1">
                      {inputState.malformedEntries.slice(0, 3).map((entry, i) => (
                        <div key={i} className="flex justify-between items-start gap-2">
                          <span className="font-mono bg-destructive/10 px-1 rounded">
                            {entry.raw}
                          </span>
                          <span className="text-right text-xs opacity-80">
                            {entry.error}
                          </span>
                        </div>
                      ))}
                      {inputState.malformedEntries.length > 3 && (
                        <div className="text-xs opacity-60 text-center">
                          ... and {inputState.malformedEntries.length - 3} more
                        </div>
                      )}
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button 
            onClick={handleQuery}
            disabled={!inputState.isValid || isQuerying}
            className="flex-1"
          >
            {isQuerying ? 'Querying...' : `Query ${inputState.validParcels.length} Parcel(s)`}
          </Button>
          <Button 
            variant="outline" 
            onClick={clearInput}
            disabled={!inputState.rawInput}
          >
            Clear
          </Button>
        </div>

        {hasAttemptedQuery && inputState.validParcels.length > 0 && (
          <div className="text-xs text-muted-foreground flex-shrink-0">
            <p className="font-medium mb-1">Valid Parcels ({inputState.validParcels.length}):</p>
            <div className="max-h-16 overflow-hidden bg-muted p-2 rounded text-xs font-mono">
              {inputState.validParcels.slice(0, 3).map((parcel, i) => (
                <div key={i}>{parcel.id}</div>
              ))}
              {inputState.validParcels.length > 3 && (
                <div className="text-muted-foreground text-center">
                  ... and {inputState.validParcels.length - 3} more
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}