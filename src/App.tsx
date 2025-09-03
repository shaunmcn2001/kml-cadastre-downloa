import React, { useState, useEffect } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { ParcelInputPanel } from './components/ParcelInputPanel';
import { MapView } from './components/MapView';
import { ExportPanel } from './components/ExportPanel';
import { DebugPanel } from './components/DebugPanel';
import { loadConfig } from './lib/config';
import { apiClient } from './lib/api';
import { toast } from 'sonner';
import type { ParcelFeature, ParcelState } from './lib/types';

function App() {
  const [features, setFeatures] = useState<ParcelFeature[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isQuerying, setIsQuerying] = useState(false);

  // Load config on app start
  useEffect(() => {
    const initializeApp = async () => {
      try {
        await loadConfig();
        // Test backend connectivity
        await apiClient.healthCheck();
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to initialize app:', error);
        toast.error('Failed to connect to backend service');
        setIsLoading(false);
      }
    };

    initializeApp();
  }, []);

  const handleQueryParcels = async (parcelIds: string[], states: ParcelState[]) => {
    if (parcelIds.length === 0) return;

    setIsQuerying(true);
    try {
      const response = await apiClient.queryParcels({
        states,
        ids: parcelIds,
        options: {
          pageSize: 1000,
          simplifyTol: 0.0001
        }
      });

      setFeatures(response.features);
      
      if (response.features.length === 0) {
        toast.warning('No parcels found for the provided identifiers');
      } else {
        toast.success(`Successfully loaded ${response.features.length} parcel(s)`);
      }
    } catch (error) {
      console.error('Query failed:', error);
      toast.error(`Query failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setFeatures([]);
    } finally {
      setIsQuerying(false);
    }
  };

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <h2 className="text-lg font-semibold text-foreground mb-2">KML Downloads</h2>
          <p className="text-muted-foreground">Connecting to backend service...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">KML Downloads</h1>
            <p className="text-sm text-muted-foreground">
              Australian Cadastral Data Extraction Tool
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            NSW • QLD • SA
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Map View - Left Side */}
        <div className="flex-1 p-4">
          <MapView features={features} isLoading={isQuerying} />
        </div>

        {/* Control Panel - Right Side */}
        <div className="w-96 border-l bg-card flex flex-col">
          <div className="p-4">
            <ParcelInputPanel 
              onQueryParcels={handleQueryParcels}
              isQuerying={isQuerying}
            />
          </div>

          <div className="p-4">
            <ExportPanel 
              features={features}
              isQuerying={isQuerying}
            />
          </div>

          <div className="mt-auto">
            <DebugPanel />
          </div>
        </div>
      </div>

      <Toaster />
    </div>
  );
}

export default App;