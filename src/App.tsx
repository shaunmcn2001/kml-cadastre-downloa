import React, { useState, useEffect } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { WifiX } from '@phosphor-icons/react';
import { ParcelInputPanel } from './components/ParcelInputPanel';
import { MapView } from './components/MapView';
import { ExportPanel } from './components/ExportPanel';
import { DebugPanel } from './components/DebugPanel';
import { ConnectionTroubleshooter } from './components/ConnectionTroubleshooter';
import { loadConfig } from './lib/config';
import { apiClient } from './lib/api';
import { toast } from 'sonner';
import type { ParcelFeature, ParcelState } from './lib/types';
import './styles/glass.css';

function App() {
  const [features, setFeatures] = useState<ParcelFeature[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isQuerying, setIsQuerying] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);

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
      <div className="app-shell">
        <div className="h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
            <h2 className="text-lg font-semibold mb-2">KML Downloads for Google Earth</h2>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Connecting to backend service...</p>
          </div>
        </div>
      </div>
    );
  }

  // Show connection troubleshooter if there's a backend error
  if (backendError) {
    return (
      <div className="app-shell">
        <ConnectionTroubleshooter onConnectionSuccess={() => setBackendError(null)} />
        <Toaster />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <div className="app-title">Cadastral Tools • All States</div>
          <div className="app-sub">Map • Search • Export — additional modules coming (Land Types, Vegetation)</div>
        </div>
        <div className="row right">
          <span className="badge mono">UI Preview</span>
        </div>
      </header>

      <main className="grid">
        {/* MAP: spans 6 on desktop */}
        <section className="card map-card" style={{ gridColumn: "span 12" }}>
          <div className="card-header">
            <span className="dot"/>
            <div>
              <div className="card-title">Map</div>
              <div className="card-sub">Interactive view & selection</div>
            </div>
          </div>
          <div className="card-body map-slot">
            <MapView features={features} isLoading={isQuerying} />
          </div>
        </section>

        {/* SEARCH: spans 6 on desktop */}
        <section className="card search-card" style={{ gridColumn: "span 12" }}>
          <div className="card-header">
            <span className="dot"/>
            <div>
              <div className="card-title">Search</div>
              <div className="card-sub">Paste Lot/Plan or use existing controls</div>
            </div>
          </div>
          <div className="card-body search-slot">
            <ParcelInputPanel 
              onQueryParcels={handleQueryParcels}
              isQuerying={isQuerying}
            />
          </div>
        </section>

        {/* EXPORT: spans 6 on desktop */}
        <section className="card export-card" style={{ gridColumn: "span 12" }}>
          <div className="card-header">
            <span className="dot"/>
            <div>
              <div className="card-title">Export</div>
              <div className="card-sub">KML/KMZ (others unchanged)</div>
            </div>
          </div>
          <div className="card-body export-slot">
            <ExportPanel 
              features={features}
              isQuerying={isQuerying}
            />
          </div>
        </section>

        {/* Debug Panel: spans 6 on desktop */}
        <section className="card debug-card" style={{ gridColumn: "span 12" }}>
          <div className="card-header">
            <span className="dot"/>
            <div>
              <div className="card-title">Debug</div>
              <div className="card-sub">Connection & performance details</div>
            </div>
          </div>
          <div className="card-body debug-slot">
            <DebugPanel />
          </div>
        </section>
      </main>
      <Toaster />
    </div>
  );
}

export default App;

