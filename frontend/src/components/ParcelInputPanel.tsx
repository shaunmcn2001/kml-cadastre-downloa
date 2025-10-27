import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Database, AlertTriangle, CheckCircle } from '@phosphor-icons/react';
import { useParcelInput } from '../hooks/useParcelInput';
import type { ParcelState } from '../lib/types';
import { NswParcelSearch } from './NswParcelSearch';

interface ParcelInputPanelProps {
  onQueryParcels: (parcelIds: string[], states: ParcelState[]) => void;
  isQuerying: boolean;
}

export function ParcelInputPanel({ onQueryParcels, isQuerying }: ParcelInputPanelProps) {
  const {
    inputState,
    updateRawInput,
    updateSelectedState,
    clearInput,
    appendParcelIdentifier
  } = useParcelInput();
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
1 RP 912949
Lot 1 RP912949
Lot 1 on RP 912949
13SP12345`,
    SA: `101//D12345
102//F23456
1/234//CT5678
15//DP789012`
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="w-5 h-5 text-primary" />
          Parcel Input
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="state-select" className="text-sm font-medium">
            Select State
          </Label>
          <Tabs 
            value={inputState.selectedState} 
            onValueChange={(value) => updateSelectedState(value as ParcelState)}
            className="w-full mt-2"
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="NSW">NSW</TabsTrigger>
              <TabsTrigger value="QLD">QLD</TabsTrigger>
              <TabsTrigger value="SA">SA</TabsTrigger>
            </TabsList>
            
            <TabsContent value="NSW" className="space-y-4 mt-4">
              <div className="text-sm text-muted-foreground">
                <p className="font-medium mb-2">NSW Format Examples:</p>
                <div className="bg-muted p-2 rounded text-xs font-mono">
                  {exampleTexts.NSW}
                </div>
                <p className="mt-2 text-xs">
                  Supports: LOT//PLAN, LOT/SECTION//PLAN, ranges (1-3//DP123), and "LOT 13 DP1242624" format
                </p>
              </div>

              <NswParcelSearch
                onParcelSelect={appendParcelIdentifier}
                disabled={isQuerying}
              />
            </TabsContent>
            
            <TabsContent value="QLD" className="space-y-3 mt-4">
              <div className="text-sm text-muted-foreground">
                <p className="font-medium mb-2">QLD Format Examples:</p>
                <div className="bg-muted p-2 rounded text-xs font-mono">
                  {exampleTexts.QLD}
                </div>
                <p className="mt-2 text-xs">
                  Supports: contiguous lotplans (e.g. 1RP912949), spaced variants (1 RP 912949),
                  and descriptive formats like “Lot 1 on RP912949”. Separate multiple entries with new
                  lines or commas.
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
            className="mt-2 min-h-32 max-h-48 font-mono text-sm resize-none scrollbar-thin"
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
                    <div className="max-h-32 overflow-y-auto text-xs space-y-1 scrollbar-thin">
                      {inputState.malformedEntries.map((entry, i) => (
                        <div key={i} className="flex justify-between items-start gap-2">
                          <span className="font-mono bg-destructive/10 px-1 rounded">
                            {entry.raw}
                          </span>
                          <span className="text-right text-xs opacity-80">
                            {entry.error}
                          </span>
                        </div>
                      ))}
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
          <div className="text-sm text-muted-foreground">
            <p className="font-medium mb-1">Valid Parcels to Query:</p>
            <div className="max-h-32 overflow-y-auto bg-muted p-2 rounded text-xs font-mono space-y-0.5 scrollbar-thin">
              {inputState.validParcels.slice(0, 50).map((parcel, i) => (
                <div key={i}>{parcel.id}</div>
              ))}
              {inputState.validParcels.length > 50 && (
                <div className="text-muted-foreground">
                  ... and {inputState.validParcels.length - 50} more
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
