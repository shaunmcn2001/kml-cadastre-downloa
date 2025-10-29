import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { parseQLD } from '@/lib/parsers';
import { apiClient } from '@/lib/api';
import { CheckCircle, Info, Warning } from '@phosphor-icons/react';

const exampleLotPlans = [
  '3/SP181800',
  '3SP181800',
  'Lot 3 on Survey Plan 181800',
  'Lot 2 on RP24834',
  '5RP12345',
  '1/BN100',
];

export function SmartMapsView() {
  const [input, setInput] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);

  const parsed = useMemo(() => parseQLD(input || ''), [input]);
  const validIds = useMemo(() => parsed.valid.map((entry) => entry.id), [parsed.valid]);

  const handleDownload = async () => {
    if (!validIds.length) {
      toast.error('Enter at least one valid QLD lot/plan to download SmartMaps');
      return;
    }

    setIsDownloading(true);
    try {
      const { blob, fileName, failures } = await apiClient.downloadSmartMaps(validIds);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1500);

      const successCount = validIds.length - failures.length;
      toast.success(`Downloaded ${successCount} SmartMap${successCount === 1 ? '' : 's'}`);
      if (failures.length) {
        toast.warning(`Some downloads failed (${failures.length}). A report is included in the ZIP.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SmartMap download failed';
      toast.error(message);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-muted/20">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <Card className="border border-primary/30 bg-card shadow-lg">
          <CardHeader>
            <CardTitle className="text-2xl font-semibold flex items-center gap-2">
              <Info className="w-5 h-5 text-primary" />
              QLD SmartMap Downloader
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              Paste QLD lot/plan identifiers (one per line). The downloader normalises each entry and
              bundles the SmartMap PDFs into a single ZIP file.
            </p>
            <div>
              <p className="font-medium text-foreground mb-2">Supported format examples:</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {exampleLotPlans.map((sample) => (
                  <li key={sample} className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-mono text-primary">
                      <CheckCircle className="w-3 h-3" />
                      {sample}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Enter Lot/Plan combinations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={`e.g.\n3/SP181800\nLot 2 on RP24834`}
              className="min-h-[200px] font-mono text-sm"
            />

            <div className="space-y-3">
              {input && (
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="px-2 py-0.5">
                    {validIds.length} valid
                  </Badge>
                  <Badge variant="outline" className="px-2 py-0.5">
                    {parsed.malformed.length} malformed
                  </Badge>
                </div>
              )}

              {parsed.malformed.length > 0 && (
                <Alert variant="destructive">
                  <Warning className="w-4 h-4" />
                  <AlertDescription>
                    <div className="space-y-1">
                      <p className="text-xs font-medium">Malformed entries:</p>
                      <ul className="text-xs space-y-1 max-h-24 overflow-y-auto scrollbar-thin">
                        {parsed.malformed.slice(0, 6).map((item, index) => (
                          <li key={`${item.raw}-${index}`}>
                            <span className="font-mono bg-destructive/10 px-1 rounded mr-2">{item.raw}</span>
                            {item.error}
                          </li>
                        ))}
                      </ul>
                      {parsed.malformed.length > 6 && (
                        <p className="text-xs italic">
                          +{parsed.malformed.length - 6} more not shown.
                        </p>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                SmartMaps are generated directly from Queensland spatial services. Large batches may take a
                minute to compile.
              </p>
              <Button
                onClick={handleDownload}
                disabled={validIds.length === 0 || isDownloading}
              >
                {isDownloading ? 'Downloading…' : `Download ${validIds.length || ''} SmartMap${validIds.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
