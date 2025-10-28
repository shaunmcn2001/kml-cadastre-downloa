import React, { useState, useEffect } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { ParcelInputPanel } from './components/ParcelInputPanel';
import { MapView } from './components/MapView';
import { ExportPanel } from './components/ExportPanel';
import { DebugPanel } from './components/DebugPanel';
import { ConnectionTroubleshooter } from './components/ConnectionTroubleshooter';
import { loadConfig } from './lib/config';
import { apiClient } from './lib/api';
import { toast } from 'sonner';
import type { ParcelFeature, ParcelState } from './lib/types';
import { PropertyReportsView } from './views/PropertyReportsView';
import { ComingSoonView } from './views/ComingSoonView';

function App() {
  const [features, setFeatures] = useState<ParcelFeature[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isQuerying, setIsQuerying] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'cadastre' | 'property-reports' | 'grazing-maps'>('cadastre');

  const testBackendConnection = async () => {
    try {
      setIsLoading(true);
      setBackendError(null);
      await apiClient.healthCheck();
      setIsLoading(false);
      toast.success('Backend connection restored');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setBackendError(errorMessage);
      setIsLoading(false);
      toast.error('Connection test failed');
    }
  };

  // Load config on app start
  useEffect(() => {
    const initializeApp = async () => {
      try {
        await loadConfig();
        
        // Test backend connectivity with retry
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
          try {
            await apiClient.healthCheck();
            setIsLoading(false);
            setBackendError(null);
            return;
          } catch (error) {
            retryCount++;
            if (retryCount < maxRetries) {
              console.log(`Health check failed, retrying (${retryCount}/${maxRetries})...`);
              await new Promise(resolve => setTimeout(resolve, 2000 * retryCount)); // Exponential backoff
            } else {
              throw error; // Re-throw after max retries
            }
          }
        }
      } catch (error) {
        console.error('Failed to initialize app:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        setBackendError(errorMessage);
        toast.error('Failed to connect to backend service - check Debug Panel for details');
        setIsLoading(false);
      }
    };

    initializeApp();
  }, []);

  const handleQueryParcels = async (parcelIds: string[], states: ParcelState[]) => {
    if (parcelIds.length === 0) return;

    setIsQuerying(true);
    setBackendError(null); // Clear any previous backend errors
    
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Check if this is a network/connection error
      if (errorMessage.includes('Network error') || errorMessage.includes('Failed to fetch')) {
        setBackendError(errorMessage);
      }
      
      toast.error(`Query failed: ${errorMessage}`);
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
          <h2 className="text-lg font-semibold text-foreground mb-2">KML Downloads for Google Earth</h2>
          <p className="text-muted-foreground">Connecting to backend service...</p>
        </div>
      </div>
    );
  }

  // Show connection troubleshooter if there's a backend error
  if (backendError) {
    return (
      <>
        <ConnectionTroubleshooter onConnectionSuccess={() => setBackendError(null)} />
        <Toaster />
      </>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">KML Downloads</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Optimized for Google Earth Web & Pro</p>
          </div>
          <div className="text-xs text-muted-foreground">
            NSW • QLD • SA • VIC
          </div>
        </div>
        <nav className="mt-4 inline-flex items-center space-x-1 rounded-full border bg-muted/40 p-1 text-xs">
          {[
            { key: 'cadastre', label: 'Cadastre' },
            { key: 'property-reports', label: 'Property Reports' },
            { key: 'grazing-maps', label: 'Grazing Maps' }
          ].map(({ key, label }) => {
            const active = activeView === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveView(key as typeof activeView)}
                className={`px-3 py-1.5 rounded-full transition ${
                  active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-background'
                }`}
              >
                {label}
              </button>
            );
          })}
        </nav>
      </header>
      {activeView === 'cadastre' && (
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 p-4">
            <MapView features={features} isLoading={isQuerying} />
          </div>

          <div className="w-96 border-l bg-card flex flex-col max-h-full">
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              <div className="p-4 space-y-6">
                <ParcelInputPanel 
                  onQueryParcels={handleQueryParcels}
                  isQuerying={isQuerying}
                />

                <ExportPanel 
                  features={features}
                  isQuerying={isQuerying}
                />
              </div>
            </div>

            <div className="border-t bg-card flex-shrink-0">
              <DebugPanel />
            </div>
          </div>
        </div>
      )}

      {activeView === 'property-reports' && <PropertyReportsView />}

      {activeView === 'grazing-maps' && (
        <ComingSoonView
          title="Grazing Maps"
          description="Layer selections and grazing-specific analytics will live here."
        />
      )}
      <Toaster />
    </div>
  );
}

export default App;
