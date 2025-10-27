import { useState, useEffect } from 'react';
import { apiClient } from '../lib/api';
import type { DebugEntry } from '../lib/types';

export function useDebugPanel() {
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const unsubscribe = apiClient.onDebugUpdate(setDebugEntries);
    setDebugEntries(apiClient.getDebugEntries());
    return unsubscribe;
  }, []);

  const clearEntries = () => {
    apiClient.clearDebugEntries();
  };

  const toggleVisibility = () => {
    setIsVisible(prev => !prev);
  };

  return {
    debugEntries,
    isVisible,
    toggleVisibility,
    clearEntries
  };
}