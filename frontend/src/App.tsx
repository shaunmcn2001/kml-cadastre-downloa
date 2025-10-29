import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { ParcelInputPanel } from './components/ParcelInputPanel';
import { MapView } from './components/MapView';
import { ExportPanel } from './components/ExportPanel';
import { DebugPanel } from './components/DebugPanel';
import { ConnectionTroubleshooter } from './components/ConnectionTroubleshooter';
import { loadConfig } from './lib/config';
import { apiClient } from './lib/api';
import { toast } from 'sonner';
import type {
  ParcelFeature,
  ParcelState,
  LandTypeFeatureCollection,
  LandTypeLegendEntry,
} from './lib/types';
import { PropertyReportsView } from './views/PropertyReportsView';
import { SmartMapsView } from './views/SmartMapsView';
import { ComingSoonView } from './views/ComingSoonView';

function App() {
  const [features, setFeatures] = useState<ParcelFeature[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isQuerying, setIsQuerying] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'cadastre' | 'property-reports' | 'grazing-maps' | 'smartmaps'>('cadastre');
  const [landTypeAvailable, setLandTypeAvailable] = useState(false);
  const [landTypeEnabled, setLandTypeEnabled] = useState(false);
  const [landTypeData, setLandTypeData] = useState<LandTypeFeatureCollection | null>(null);
  const [landTypeIsLoading, setLandTypeIsLoading] = useState(false);
  const [landTypeSource, setLandTypeSource] = useState<'lotplans' | 'bbox'>('lotplans');
  const [landTypeLastBbox, setLandTypeLastBbox] = useState<[number, number, number, number] | null>(null);
  const lastLandTypeKeyRef = useRef<string | null>(null);
  const navIndicatorRef = useRef<HTMLSpanElement | null>(null);
  const navButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const navItems: Array<{ key: typeof activeView; label: string }> = [
    { key: 'cadastre', label: 'Cadastre' },
    { key: 'property-reports', label: 'Property Reports' },
    { key: 'grazing-maps', label: 'Grazing Maps' },
    { key: 'smartmaps', label: 'SmartMaps' },
  ];

  const updateNavIndicator = useCallback(() => {
    const indicator = navIndicatorRef.current;
    const activeButton = navButtonRefs.current[activeView];
    if (!indicator || !activeButton) return;
    const parent = activeButton.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const rect = activeButton.getBoundingClientRect();
    indicator.style.width = `${rect.width}px`;
    indicator.style.transform = `translateX(${rect.left - parentRect.left}px)`;
  }, [activeView]);

  useLayoutEffect(() => {
    updateNavIndicator();
  }, [updateNavIndicator]);

  useEffect(() => {
    const handleResize = () => updateNavIndicator();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateNavIndicator]);

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
        const cfg = await loadConfig();
        const landTypeFlag = Boolean(cfg.features?.landtypeEnabled);
        setLandTypeAvailable(landTypeFlag);
        if (!landTypeFlag) {
          setLandTypeEnabled(false);
          setLandTypeData(null);
          lastLandTypeKeyRef.current = null;
        }
        
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

  const landTypeLotPlans = useMemo(() => {
    const ids = new Set<string>();
    for (const feature of features) {
      if (feature.properties.state !== 'QLD') {
        continue;
      }
      const props = feature.properties;
      const candidate =
        (props.lotplan ??
          (props as any).LOTPLAN ??
          props.lotPlan ??
          props.id ??
          props.name ??
          '') as string;
      const normalized = String(candidate).replace(/\s+/g, '').toUpperCase();
      if (!normalized) {
        continue;
      }
      ids.add(normalized);
    }
    return Array.from(ids);
  }, [features]);

  const landTypeLotPlanKey = useMemo(() => landTypeLotPlans.join('|'), [landTypeLotPlans]);

  const fetchLandTypeData = useCallback(
    async (
      params: {
        lotplans?: string[];
        bbox?: [number, number, number, number];
      },
      options?: { force?: boolean },
    ) => {
      if (!landTypeAvailable) {
        return;
      }
      const key = params.lotplans
        ? `lotplans|${params.lotplans.join('|')}`
        : params.bbox
        ? `bbox|${params.bbox.join(',')}`
        : 'none';
      if (!options?.force && lastLandTypeKeyRef.current === key) {
        return;
      }
      lastLandTypeKeyRef.current = key;
      setLandTypeIsLoading(true);
      try {
        const data = await apiClient.fetchLandTypeGeojson(params);
        setLandTypeData(data);
      } catch (error) {
        console.error('LandType query failed:', error);
        toast.error(
          `LandType query failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      } finally {
        setLandTypeIsLoading(false);
      }
    },
    [landTypeAvailable],
  );

  const handleLandTypeToggle = useCallback(
    (enabled: boolean) => {
      if (enabled && !landTypeAvailable) {
        toast.error('LandType workflow is disabled in this deployment.');
        return;
      }
      setLandTypeEnabled(enabled);
      if (!enabled) {
        setLandTypeData(null);
        lastLandTypeKeyRef.current = null;
        return;
      }
      if (landTypeSource === 'lotplans') {
        if (landTypeLotPlans.length === 0) {
          toast.warning('No QLD lotplans available for LandType.');
          setLandTypeData(null);
          return;
        }
        fetchLandTypeData({ lotplans: landTypeLotPlans }, { force: true });
      } else if (landTypeLastBbox) {
        fetchLandTypeData({ bbox: landTypeLastBbox }, { force: true });
      } else {
        toast.info('Pan/zoom the map and refresh LandType for the current extent.');
      }
    },
    [
      landTypeAvailable,
      landTypeLotPlans,
      landTypeSource,
      landTypeLastBbox,
      fetchLandTypeData,
    ],
  );

  const handleLandTypeSourceChange = useCallback((source: 'lotplans' | 'bbox') => {
    setLandTypeSource(source);
  }, []);

  const handleLandTypeRefresh = useCallback(() => {
    if (!landTypeAvailable || !landTypeEnabled) {
      toast.warning('Enable the LandType overlay on the map before exporting.');
      return;
    }
    if (landTypeSource === 'lotplans') {
      if (landTypeLotPlans.length === 0) {
        toast.warning('No QLD lotplans available to refresh.');
        return;
      }
      fetchLandTypeData({ lotplans: landTypeLotPlans }, { force: true });
    } else {
      if (!landTypeLastBbox) {
        toast.info('Pan/zoom the map and refresh LandType to capture the current extent.');
        return;
      }
      fetchLandTypeData({ bbox: landTypeLastBbox }, { force: true });
    }
  }, [
    landTypeAvailable,
    landTypeEnabled,
    landTypeSource,
    landTypeLotPlans,
    landTypeLastBbox,
    fetchLandTypeData,
  ]);

  const handleLandTypeRefreshBbox = useCallback(
    (bbox: [number, number, number, number]) => {
      setLandTypeSource('bbox');
      setLandTypeLastBbox(bbox);
      if (landTypeEnabled) {
        fetchLandTypeData({ bbox }, { force: true });
      }
    },
    [fetchLandTypeData, landTypeEnabled],
  );

  useEffect(() => {
    if (!landTypeAvailable || !landTypeEnabled) {
      return;
    }
    if (landTypeSource === 'lotplans') {
      if (landTypeLotPlans.length === 0) {
        setLandTypeData(null);
        lastLandTypeKeyRef.current = null;
        return;
      }
      fetchLandTypeData({ lotplans: landTypeLotPlans });
    } else if (landTypeSource === 'bbox') {
      if (landTypeLastBbox) {
        fetchLandTypeData({ bbox: landTypeLastBbox });
      }
    }
  }, [
    landTypeAvailable,
    landTypeEnabled,
    landTypeSource,
    landTypeLotPlanKey,
    landTypeLotPlans,
    landTypeLastBbox,
    fetchLandTypeData,
  ]);

  const landTypeLegend = useMemo<LandTypeLegendEntry[]>(
    () => landTypeData?.properties?.legend ?? [],
    [landTypeData],
  );
  const landTypeWarnings = useMemo(
    () => landTypeData?.properties?.warnings ?? [],
    [landTypeData],
  );

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <h2 className="text-lg font-semibold text-foreground mb-2">Praedia</h2>
          <p className="text-muted-foreground">Connecting to spatial services…</p>
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
        <div className="flex flex-col gap-6">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="text-center sm:text-left">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Praedia</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Cadastre & property analytics for Google Earth
              </p>
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-muted-foreground">
              NSW • QLD • SA • VIC
            </div>
          </div>
          <nav className="relative flex justify-center">
            <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-8 sm:-translate-y-10">
              <div className="relative inline-flex items-center rounded-full bg-muted/20 px-1 py-1 shadow-lg shadow-primary/20 backdrop-blur">
                <span
                  ref={navIndicatorRef}
                  className="pointer-events-none absolute top-1 bottom-1 left-0 rounded-full bg-primary shadow transition-all duration-300 ease-out"
                  style={{ width: 0, transform: 'translateX(0px)' }}
                  aria-hidden="true"
                />
                {navItems.map(({ key, label }) => {
                  const active = activeView === key;
                  return (
                    <button
                      key={key}
                      ref={(element) => {
                        navButtonRefs.current[key] = element;
                      }}
                      type="button"
                      onClick={() => setActiveView(key)}
                      className={`relative z-10 rounded-full px-5 py-1.5 text-sm font-medium transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 ${active ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                      aria-pressed={active}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="h-8" aria-hidden="true" />
          </nav>
        </div>
      </header>
      {activeView === 'cadastre' && (
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 p-4">
            <MapView
              features={features}
              isLoading={isQuerying}
              landTypeAvailable={landTypeAvailable}
              landTypeEnabled={landTypeEnabled}
              landTypeIsLoading={landTypeIsLoading}
              landTypeData={landTypeData}
              landTypeLegend={landTypeLegend}
              landTypeWarnings={landTypeWarnings}
              landTypeSource={landTypeSource}
              landTypeLotPlans={landTypeLotPlans}
              onLandTypeToggle={handleLandTypeToggle}
              onLandTypeSourceChange={handleLandTypeSourceChange}
              onLandTypeRefresh={handleLandTypeRefresh}
              onLandTypeRefreshBbox={handleLandTypeRefreshBbox}
            />
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
                  landTypeAvailable={landTypeAvailable}
                  landTypeEnabled={landTypeEnabled}
                  landTypeData={landTypeData}
                  landTypeIsLoading={landTypeIsLoading}
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
      {activeView === 'smartmaps' && <SmartMapsView />}
      <Toaster />
    </div>
  );
}

export default App;
