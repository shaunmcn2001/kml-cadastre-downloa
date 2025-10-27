export interface Config {
  BACKEND_URL: string;
}

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
    
    // Validate that the backend URL is accessible
    console.log('Loaded config:', config);
    return config!;
  } catch (error) {
    console.error('Failed to load config, using defaults:', error);
    // Check if we're in development vs production
    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    config = {
      BACKEND_URL: isDev ? 'http://localhost:8000' : 'https://kml-cadastre-downloa.onrender.com'
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