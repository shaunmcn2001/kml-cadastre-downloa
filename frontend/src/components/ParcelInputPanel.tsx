import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Database, WarningCircle, CheckCircle } from '@phosphor-icons/react';
import { useParcelInput } from '../hooks/useParcelInput';
import type { ParcelState } from '../lib/types';

interface ParcelInputPanelProps {
  onQueryParcels: (parcelIds: string[], states: ParcelState[]) => void;
  isQuerying: boolean;
  onClearResults?: () => void;
}

export function ParcelInputPanel({ onQueryParcels, isQuerying, onClearResults }: ParcelInputPanelProps) {
  const {
    inputState,
    updateRawInput,
    updateSelectedState,
    clearInput
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

  const handleClear = () => {
    clearInput();
    setHasAttemptedQuery(false);
    onClearResults?.();
  };

  const exampleTexts = {
    NSW: `1//DP131118
LOT 13 DP1242624
1-3//DP555123
10/4/DP203489
8/A/DP30493`,
    QLD: `1RP912949
1 RP 912949
Lot 1 RP912949
Lot 1 on RP 912949
13SP12345`,
    SA: `CT6204/831
D117877 A22
A22 D117877
Lot A1 D12345
Lot S1 on S204930
H210300S562`,
    VIC: `27\\PS433970
27/PS433970
27 PS433970
Lot 27 PS433970`
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
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="NSW">NSW</TabsTrigger>
              <TabsTrigger value="QLD">QLD</TabsTrigger>
              <TabsTrigger value="SA">SA</TabsTrigger>
              <TabsTrigger value="VIC">VIC</TabsTrigger>
            </TabsList>
            
            <TabsContent value="NSW" className="space-y-3 mt-4">
              <div className="text-sm text-muted-foreground">
                <p className="font-medium mb-2">NSW Format Examples:</p>
                <div className="bg-muted p-2 rounded text-xs font-mono">
                  {exampleTexts.NSW}
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="QLD" className="space-y-3 mt-4">
              <div className="text-sm text-muted-foreground">
                <p className="font-medium mb-2">QLD Format Examples:</p>
                <div className="bg-muted p-2 rounded text-xs font-mono">
                  {exampleTexts.QLD}
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="SA" className="space-y-3 mt-4">
              <div className="text-sm text-muted-foreground">
                <p className="font-medium mb-2">SA Format Examples:</p>
                <div className="bg-muted p-2 rounded text-xs font-mono">
                  {exampleTexts.SA}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="VIC" className="space-y-3 mt-4">
              <div className="text-sm text-muted-foreground">
                <p className="font-medium mb-2">VIC Format Examples:</p>
                <div className="bg-muted p-2 rounded text-xs font-mono">
                  {exampleTexts.VIC}
                </div>
                <p className="mt-2 text-xs">
                  Supports: PARCEL_SPI values like <code>27\PS433970</code> and flexible inputs such as
                  <code>27/PS433970</code> or <code>Lot 27 PS433970</code>. Backslashes are added automatically.
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
                <WarningCircle className="h-4 w-4" />
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
            onClick={handleClear}
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
