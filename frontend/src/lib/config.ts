export interface FeatureFlags {
  landtypeEnabled?: boolean;
}

export interface DatasetConfigEntry {
  id: string;
  label?: string;
  geometry?: string;
  color?: string;
}

export interface Config {
  BACKEND_URL: string;
  features?: FeatureFlags;
  datasets?: DatasetConfigEntry[];
}

const DEFAULT_FEATURES: FeatureFlags = {
  landtypeEnabled: false,
};

const DEFAULT_DATASETS: DatasetConfigEntry[] = [
  { id: 'landtypes', label: 'Land Types', geometry: 'polygon', color: '#6B8E23' },
  { id: 'vegetation', label: 'Regulated Vegetation', geometry: 'polygon', color: '#2BB673' },
  { id: 'bores', label: 'Registered Water Bores', geometry: 'point', color: '#E3B57C' },
  { id: 'easements', label: 'Easements', geometry: 'polygon', color: '#B9A2FF' },
  { id: 'farm_dams', label: 'Farm Dams', geometry: 'point', color: '#8FD3FF' },
  { id: 'watercourses', label: 'Watercourses', geometry: 'polyline', color: '#2AA1FF' },
  { id: 'water_bores', label: 'Water Bores', geometry: 'point', color: '#E3B57C' },
];

let config: Config | null = null;

export async function loadConfig(): Promise<Config> {
  if (config) {
    return config;
  }
  
  try {
    const response = await fetch('/config.json');
    if (!response.ok) {
      throw new Error(`Failed to load config: ${response.status}`);
    }
    config = await response.json();
    config.features = { ...DEFAULT_FEATURES, ...(config.features || {}) };
    config.datasets = Array.isArray(config.datasets) && config.datasets.length ? config.datasets : DEFAULT_DATASETS;
    
    // Validate that the backend URL is accessible
    console.log('Loaded config:', config);
    return config!;
  } catch (error) {
    console.error('Failed to load config, using defaults:', error);
    // Check if we're in development vs production
    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    config = {
      BACKEND_URL: isDev ? 'http://localhost:8000' : 'https://kml-cadastre-downloa.onrender.com',
      features: { ...DEFAULT_FEATURES },
      datasets: DEFAULT_DATASETS,
    };
    console.log('Using fallback config:', config);
    return config;
  }
}

export function getConfig(): Config {
  if (!config) {
    throw new Error('Config not loaded. Call loadConfig() first.');
  }
  return config;
}
