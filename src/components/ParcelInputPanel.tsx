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
    <div className="h-full flex flex-col space-y-2 overflow-hidden">
      <div className="flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Database className="w-3 h-3 text-primary" />
          <span className="font-medium text-xs">Parcel Input</span>
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-hidden">
        <div className="flex-shrink-0">
          <Label htmlFor="state-select" className="text-xs font-medium">
            Select State
          </Label>
          <Tabs 
            value={inputState.selectedState} 
            onValueChange={(value) => updateSelectedState(value as ParcelState)}
            className="w-full mt-1"
          >
            <TabsList className="grid w-full grid-cols-3 h-7 max-h-7 min-h-7">
              <TabsTrigger value="NSW" className="h-6 max-h-6 text-xs py-0 px-2 font-medium">NSW</TabsTrigger>
              <TabsTrigger value="QLD" className="h-6 max-h-6 text-xs py-0 px-2 font-medium">QLD</TabsTrigger>
              <TabsTrigger value="SA" className="h-6 max-h-6 text-xs py-0 px-2 font-medium">SA</TabsTrigger>
            </TabsList>
            
            <TabsContent value="NSW" className="space-y-2 mt-2 overflow-hidden">
              <div className="text-xs text-muted-foreground">
                <p className="font-medium mb-1 text-xs">NSW Format:</p>
                <div className="bg-muted p-2 rounded text-xs font-mono max-h-12 overflow-hidden">
                  {exampleTexts.NSW}
                </div>
                <p className="mt-1 text-xs leading-tight">
                  LOT//PLAN, ranges (1-3//DP123), "LOT 13 DP1242624"
                </p>
              </div>
            </TabsContent>
            
            <TabsContent value="QLD" className="space-y-2 mt-2 overflow-hidden">
              <div className="text-xs text-muted-foreground">
                <p className="font-medium mb-1 text-xs">QLD Format:</p>
                <div className="bg-muted p-2 rounded text-xs font-mono max-h-12 overflow-hidden">
                  {exampleTexts.QLD}
                </div>
                <p className="mt-1 text-xs leading-tight">
                  lotidstring format (numbers + letters + numbers)
                </p>
              </div>
            </TabsContent>
            
            <TabsContent value="SA" className="space-y-2 mt-2 overflow-hidden">
              <div className="text-xs text-muted-foreground">
                <p className="font-medium mb-1 text-xs">SA Format:</p>
                <div className="bg-muted p-2 rounded text-xs font-mono max-h-12 overflow-hidden">
                  {exampleTexts.SA}
                </div>
                <p className="mt-1 text-xs leading-tight">
                  PARCEL//PLAN and VOLUME/FOLIO//PLAN formats
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex-shrink-0">
          <Label htmlFor="parcel-input" className="text-xs font-medium">
            Parcel Identifiers
          </Label>
          <Textarea
            id="parcel-input"
            placeholder={`Enter ${inputState.selectedState} parcel identifiers...`}
            value={inputState.rawInput}
            onChange={(e) => updateRawInput(e.target.value)}
            className="mt-1 min-h-16 max-h-20 font-mono text-xs resize-none overflow-hidden"
          />
        </div>

        {inputState.rawInput && (
          <div className="space-y-2 overflow-hidden flex-1">
            {inputState.validParcels.length > 0 && (
              <Alert className="py-2">
                <CheckCircle className="h-3 w-3" />
                <AlertDescription>
                  <div className="flex items-center justify-between text-xs">
                    <span>
                      <strong>{inputState.validParcels.length}</strong> valid parcel(s)
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {inputState.selectedState}
                    </Badge>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {inputState.malformedEntries.length > 0 && (
              <Alert variant="destructive" className="py-2">
                <AlertTriangle className="h-3 w-3" />
                <AlertDescription>
                  <div className="space-y-1">
                    <p className="text-xs"><strong>{inputState.malformedEntries.length}</strong> malformed:</p>
                    <div className="max-h-16 overflow-hidden text-xs space-y-1">
                      {inputState.malformedEntries.slice(0, 2).map((entry, i) => (
                        <div key={i} className="flex justify-between items-start gap-1">
                          <span className="font-mono bg-destructive/10 px-1 rounded text-xs">
                            {entry.raw.slice(0, 15)}...
                          </span>
                          <span className="text-right text-xs opacity-80 truncate">
                            {entry.error.slice(0, 20)}
                          </span>
                        </div>
                      ))}
                      {inputState.malformedEntries.length > 2 && (
                        <div className="text-xs opacity-60 text-center">
                          +{inputState.malformedEntries.length - 2} more
                        </div>
                      )}
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <div className="flex gap-2 flex-shrink-0">
          <Button 
            onClick={handleQuery}
            disabled={!inputState.isValid || isQuerying}
            className="flex-1 text-xs py-2"
          >
            {isQuerying ? 'Querying...' : `Query ${inputState.validParcels.length}`}
          </Button>
          <Button 
            variant="outline" 
            onClick={clearInput}
            disabled={!inputState.rawInput}
            className="text-xs py-2 px-3"
          >
            Clear
          </Button>
        </div>

        {hasAttemptedQuery && inputState.validParcels.length > 0 && (
          <div className="text-xs text-muted-foreground flex-shrink-0 overflow-hidden">
            <p className="font-medium mb-1 text-xs">Valid ({inputState.validParcels.length}):</p>
            <div className="max-h-12 overflow-hidden bg-muted p-2 rounded text-xs font-mono">
              {inputState.validParcels.slice(0, 2).map((parcel, i) => (
                <div key={i} className="truncate">{parcel.id}</div>
              ))}
              {inputState.validParcels.length > 2 && (
                <div className="text-muted-foreground text-center">
                  +{inputState.validParcels.length - 2} more
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}