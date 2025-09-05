import React, { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ChevronDown, Bug, Trash, Clock, Wifi, WifiX } from '@phosphor-icons/react';
import { useDebugPanel } from '../hooks/useDebugPanel';
import { apiClient } from '../lib/api';
import { getConfig } from '../lib/config';
import { toast } from 'sonner';

export function DebugPanel() {
  const { debugEntries, isVisible, toggleVisibility, clearEntries } = useDebugPanel();
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'success' | 'failed'>('unknown');

  const testConnection = async () => {
    setIsTestingConnection(true);
    try {
      await apiClient.healthCheck();
      setConnectionStatus('success');
      toast.success('Backend connection successful');
    } catch (error) {
      setConnectionStatus('failed');
      toast.error(`Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const formatDuration = (duration?: number) => {
    if (!duration) return 'N/A';
    return `${duration}ms`;
  };

  const getStatusColor = (status?: number, error?: string) => {
    if (error) return 'destructive';
    if (!status) return 'secondary';
    if (status >= 200 && status < 300) return 'default';
    if (status >= 400) return 'destructive';
    return 'secondary';
  };

  const config = getConfig();

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Collapsible open={isVisible} onOpenChange={toggleVisibility} className="h-full flex flex-col">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between p-2 h-auto flex-shrink-0">
            <div className="flex items-center gap-2">
              <Bug className="w-3 h-3" />
              <span className="text-xs font-medium">Debug</span>
              {debugEntries.length > 0 && (
                <Badge variant="secondary" className="text-xs px-1">
                  {debugEntries.length}
                </Badge>
              )}
            </div>
            <ChevronDown className={`w-3 h-3 transition-transform ${isVisible ? 'rotate-180' : ''}`} />
          </Button>
        </CollapsibleTrigger>
        
        <CollapsibleContent className="px-2 pb-2 flex-1 overflow-hidden">
          <div className="space-y-2 h-full flex flex-col">
            {/* Connection Status & Test */}
            <div className="bg-muted/30 rounded-lg p-2 flex-shrink-0">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1">
                  {connectionStatus === 'success' && <Wifi className="w-3 h-3 text-accent" />}
                  {connectionStatus === 'failed' && <WifiX className="w-3 h-3 text-destructive" />}
                  {connectionStatus === 'unknown' && <Wifi className="w-3 h-3 text-muted-foreground" />}
                  <span className="text-xs font-medium">Backend</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={testConnection}
                  disabled={isTestingConnection}
                  className="h-5 px-2 text-xs"
                >
                  {isTestingConnection ? 'Testing...' : 'Test'}
                </Button>
              </div>
              <div className="text-xs space-y-1">
                <div className="font-mono bg-muted p-1 rounded break-all text-xs max-h-8 overflow-hidden">
                  {config.BACKEND_URL.length > 40 ? `${config.BACKEND_URL.substring(0, 40)}...` : config.BACKEND_URL}
                </div>
                <div className="text-muted-foreground text-xs">
                  {connectionStatus === 'success' && '✓ OK'}
                  {connectionStatus === 'failed' && '✗ Failed'}
                  {connectionStatus === 'unknown' && 'Untested'}
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center flex-shrink-0">
              <span className="text-xs font-medium">Requests</span>
              <Button
                variant="outline"
                size="sm"
                onClick={clearEntries}
                disabled={debugEntries.length === 0}
                className="h-5 px-2 text-xs"
              >
                <Trash className="w-3 h-3" />
              </Button>
            </div>
            
            {debugEntries.length === 0 ? (
              <div className="text-center py-2 text-muted-foreground flex-1">
                <p className="text-xs">No requests yet</p>
              </div>
            ) : (
              <div className="space-y-1 flex-1 overflow-hidden">
                {debugEntries.slice().reverse().slice(0, 2).map((entry, index) => (
                  <div key={index} className="border rounded-lg p-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className="text-xs font-mono px-1 h-4">
                          {entry.method}
                        </Badge>
                        <Badge 
                          variant={getStatusColor(entry.status, entry.error)}
                          className="text-xs px-1 h-4"
                        >
                          {entry.error ? 'ERR' : entry.status || 'PEND'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="w-2 h-2" />
                        {formatDuration(entry.duration)}
                      </div>
                    </div>
                    
                    <div className="text-xs font-mono bg-muted p-1 rounded break-all max-h-6 overflow-hidden">
                      {entry.url.length > 35 ? `${entry.url.substring(0, 35)}...` : entry.url}
                    </div>
                    
                    {entry.error && (
                      <div className="text-xs text-destructive max-h-4 overflow-hidden">
                        {entry.error.length > 25 ? `${entry.error.substring(0, 25)}...` : entry.error}
                      </div>
                    )}
                  </div>
                ))}
                {debugEntries.length > 2 && (
                  <div className="text-xs text-center text-muted-foreground py-1">
                    +{debugEntries.length - 2} more
                  </div>
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}