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
    <div className="border-t">
      <Collapsible open={isVisible} onOpenChange={toggleVisibility}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between p-4 h-auto">
            <div className="flex items-center gap-2">
              <Bug className="w-4 h-4" />
              <span className="text-sm font-medium">Debug Panel</span>
              {debugEntries.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {debugEntries.length}
                </Badge>
              )}
            </div>
            <ChevronDown className={`w-4 h-4 transition-transform ${isVisible ? 'rotate-180' : ''}`} />
          </Button>
        </CollapsibleTrigger>
        
        <CollapsibleContent className="px-4 pb-4">
          <div className="space-y-3">
            {/* Connection Status & Test */}
            <div className="bg-muted/30 rounded-lg p-3">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {connectionStatus === 'success' && <Wifi className="w-4 h-4 text-accent" />}
                  {connectionStatus === 'failed' && <WifiX className="w-4 h-4 text-destructive" />}
                  {connectionStatus === 'unknown' && <Wifi className="w-4 h-4 text-muted-foreground" />}
                  <span className="text-sm font-medium">Backend Connection</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={testConnection}
                  disabled={isTestingConnection}
                >
                  {isTestingConnection ? 'Testing...' : 'Test'}
                </Button>
              </div>
              <div className="text-xs space-y-1">
                <div className="font-mono bg-muted p-2 rounded break-all">
                  {config.BACKEND_URL}
                </div>
                <div className="text-muted-foreground">
                  {connectionStatus === 'success' && '✓ Backend is responding'}
                  {connectionStatus === 'failed' && '✗ Cannot reach backend - check service status'}
                  {connectionStatus === 'unknown' && 'Click "Test" to check connectivity'}
                </div>
              </div>
            </div>
            
            <Separator />

            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">API Request History</span>
              <Button
                variant="outline"
                size="sm"
                onClick={clearEntries}
                disabled={debugEntries.length === 0}
              >
                <Trash className="w-3 h-3 mr-1" />
                Clear
              </Button>
            </div>
            
            <Separator />
            
            {debugEntries.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <p className="text-sm">No API requests yet</p>
                <p className="text-xs mt-1">Debug information will appear here after making requests</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {debugEntries.slice().reverse().map((entry, index) => (
                  <div key={index} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs font-mono">
                          {entry.method}
                        </Badge>
                        <Badge 
                          variant={getStatusColor(entry.status, entry.error)}
                          className="text-xs"
                        >
                          {entry.error ? 'ERROR' : entry.status || 'PENDING'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {formatDuration(entry.duration)}
                      </div>
                    </div>
                    
                    <div>
                      <div className="text-xs font-mono bg-muted p-2 rounded break-all">
                        {entry.url}
                      </div>
                    </div>
                    
                    {entry.error && (
                      <div className="text-xs text-destructive bg-destructive/5 p-2 rounded">
                        <strong>Error:</strong> {entry.error}
                      </div>
                    )}
                    
                    <div className="text-xs text-muted-foreground">
                      {entry.timestamp.toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            <div className="text-xs text-muted-foreground pt-2 border-t">
              <p>This panel shows all API requests made to the backend service.</p>
              <p className="mt-1">Use this to debug connectivity issues or performance problems.</p>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}