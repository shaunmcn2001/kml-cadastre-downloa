/**
 * Network diagnostics utility to help troubleshoot connectivity issues
 */

export interface DiagnosticResult {
  test: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  details?: string;
}

export class NetworkDiagnostics {
  static async runDiagnostics(backendUrl: string): Promise<DiagnosticResult[]> {
    const results: DiagnosticResult[] = [];

    // Test 1: Basic URL validation
    try {
      new URL(backendUrl);
      results.push({
        test: 'URL Validation',
        status: 'pass',
        message: 'Backend URL is properly formatted'
      });
    } catch {
      results.push({
        test: 'URL Validation',
        status: 'fail',
        message: 'Invalid backend URL format',
        details: `URL: ${backendUrl}`
      });
      return results; // Can't continue with invalid URL
    }

    // Test 2: DNS resolution check (basic fetch attempt)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(backendUrl, {
        method: 'HEAD',
        signal: controller.signal,
        mode: 'no-cors' // This bypasses CORS for basic connectivity test
      });

      clearTimeout(timeout);
      results.push({
        test: 'Basic Connectivity',
        status: 'pass',
        message: 'Can reach the backend domain'
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        results.push({
          test: 'Basic Connectivity',
          status: 'fail',
          message: 'Connection timeout - backend is unreachable',
          details: 'The backend service may be offline or experiencing high latency'
        });
      } else {
        results.push({
          test: 'Basic Connectivity',
          status: 'fail',
          message: 'Cannot reach backend domain',
          details: 'Check if the service is running and the URL is correct'
        });
      }
    }

    // Test 3: CORS preflight check
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${backendUrl}/healthz`, {
        method: 'GET',
        signal: controller.signal,
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        results.push({
          test: 'CORS & Health Check',
          status: 'pass',
          message: `Backend is healthy and CORS is configured`,
          details: `Response: ${JSON.stringify(data)}`
        });
      } else {
        results.push({
          test: 'CORS & Health Check',
          status: 'fail',
          message: `Backend responded with error ${response.status}`,
          details: response.statusText
        });
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          results.push({
            test: 'CORS & Health Check',
            status: 'fail',
            message: 'Health check timeout',
            details: 'Backend took too long to respond'
          });
        } else if (error.message.includes('CORS')) {
          results.push({
            test: 'CORS & Health Check',
            status: 'fail',
            message: 'CORS policy blocks the request',
            details: 'Backend needs to allow requests from your frontend domain'
          });
        } else {
          results.push({
            test: 'CORS & Health Check',
            status: 'fail',
            message: 'Health check failed',
            details: error.message
          });
        }
      } else {
        results.push({
          test: 'CORS & Health Check',
          status: 'fail',
          message: 'Unknown health check error'
        });
      }
    }

    // Test 4: Current domain check
    const currentDomain = window.location.origin;
    results.push({
      test: 'Frontend Domain',
      status: 'pass',
      message: `Running from: ${currentDomain}`,
      details: 'Ensure this domain is allowed in backend CORS settings'
    });

    return results;
  }
}