import { useState, useCallback } from 'react';
import type { ParcelState, ParsedParcel } from '../lib/types';
import { parseParcelInput } from '../lib/parsers';

export interface ParcelInputState {
  rawInput: string;
  selectedState: ParcelState;
  validParcels: ParsedParcel[];
  malformedEntries: Array<{ raw: string; error: string }>;
  isValid: boolean;
}

export function useParcelInput() {
  const [inputState, setInputState] = useState<ParcelInputState>({
    rawInput: '',
    selectedState: 'NSW',
    validParcels: [],
    malformedEntries: [],
    isValid: false
  });

  const updateRawInput = useCallback((rawInput: string) => {
    setInputState(prev => {
      if (rawInput === prev.rawInput) return prev;
      
      if (!rawInput.trim()) {
        return {
          ...prev,
          rawInput,
          validParcels: [],
          malformedEntries: [],
          isValid: false
        };
      }

      const { valid, malformed } = parseParcelInput(prev.selectedState, rawInput);
      
      return {
        ...prev,
        rawInput,
        validParcels: valid,
        malformedEntries: malformed,
        isValid: valid.length > 0
      };
    });
  }, []);

  const updateSelectedState = useCallback((selectedState: ParcelState) => {
    setInputState(prev => {
      if (selectedState === prev.selectedState) return prev;
      
      if (!prev.rawInput.trim()) {
        return { ...prev, selectedState };
      }

      const { valid, malformed } = parseParcelInput(selectedState, prev.rawInput);
      
      return {
        ...prev,
        selectedState,
        validParcels: valid,
        malformedEntries: malformed,
        isValid: valid.length > 0
      };
    });
  }, []);

  const clearInput = useCallback(() => {
    setInputState(prev => ({
      ...prev,
      rawInput: '',
      validParcels: [],
      malformedEntries: [],
      isValid: false
    }));
  }, []);

  return {
    inputState,
    updateRawInput,
    updateSelectedState,
    clearInput
  };
}