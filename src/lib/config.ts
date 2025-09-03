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
    return config!;
  } catch (error) {
    console.error('Failed to load config, using defaults:', error);
    config = {
      BACKEND_URL: 'http://localhost:8000'
    };
    return config;
  }
}

export function getConfig(): Config {
  if (!config) {
    throw new Error('Config not loaded. Call loadConfig() first.');
  }
  return config;
}