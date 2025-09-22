import React, { useEffect, useState } from 'react';
import { MagnifyingGlass, Info } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { apiClient } from '../lib/api';
import type { ParcelSearchResult } from '../lib/types';
import { toast } from 'sonner';

interface NswParcelSearchProps {
  onParcelSelect: (identifier: string) => boolean;
  disabled?: boolean;
}

const MIN_QUERY_LENGTH = 2;

export function NswParcelSearch({ onParcelSelect, disabled }: NswParcelSearchProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [results, setResults] = useState<ParcelSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedTerm(searchTerm.trim());
    }, 400);

    return () => {
      clearTimeout(handler);
    };
  }, [searchTerm]);

  useEffect(() => {
    if (!debouncedTerm || debouncedTerm.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setError(null);
      setHasSearched(false);
      return;
    }

    let isCancelled = false;

    const performSearch = async () => {
      setIsSearching(true);
      setError(null);
      setHasSearched(true);

      try {
        const response = await apiClient.searchParcels({
          state: 'NSW',
          term: debouncedTerm,
          page: 1,
          pageSize: 10
        });

        if (!isCancelled) {
          setResults(response);
        }
      } catch (err) {
        if (isCancelled) {
          return;
        }

        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        setResults([]);
        toast.error(`Search failed: ${errorMessage}`);
      } finally {
        if (!isCancelled) {
          setIsSearching(false);
        }
      }
    };

    performSearch();

    return () => {
      isCancelled = true;
    };
  }, [debouncedTerm]);

  const handleSelect = (result: ParcelSearchResult) => {
    const token = result.plan && result.lot ? `${result.lot}//${result.plan}` : result.id;
    const appended = onParcelSelect(token);

    if (appended) {
      toast.success(`Added ${token} to NSW parcel list`);
      setSearchTerm('');
      setDebouncedTerm('');
      setResults([]);
      setHasSearched(false);
    } else {
      toast.info(`${token} is already in the NSW parcel list`);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">Search NSW Parcels</p>
          <p className="text-xs text-muted-foreground">
            Type at least two characters to look up parcels by address, lot, or plan.
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="NSW search source information"
            >
              <Info className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            NSW search results stream directly from the Spatial Services MapServer/9 catalog.
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="relative">
        <MagnifyingGlass
          className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search by address, lot, or plan..."
          className="pl-8"
          disabled={disabled}
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}

      {isSearching && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-3 w-3 animate-spin rounded-full border border-muted-foreground border-t-transparent"></div>
          Querying MapServer/9…
        </div>
      )}

      {!isSearching && hasSearched && results.length === 0 && !error && (
        <Alert>
          <AlertDescription className="text-xs">No parcels found for "{debouncedTerm}".</AlertDescription>
        </Alert>
      )}

      {results.length > 0 && (
        <ScrollArea className="max-h-48">
          <div className="space-y-1">
            {results.map((result) => {
              const token = result.plan && result.lot ? `${result.lot}//${result.plan}` : result.id;
              return (
                <Button
                  key={result.id}
                  type="button"
                  variant="ghost"
                  className="w-full justify-start text-left"
                  onClick={() => handleSelect(result)}
                  disabled={disabled}
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-foreground">{result.label}</span>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {token && (
                        <Badge variant="secondary" className="font-mono text-[10px] uppercase">
                          {token}
                        </Badge>
                      )}
                      {result.address && <span>{result.address}</span>}
                      {result.locality && (
                        <span className="text-muted-foreground/80">{result.locality}</span>
                      )}
                    </div>
                  </div>
                </Button>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

