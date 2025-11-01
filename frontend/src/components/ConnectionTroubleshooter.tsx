import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Wifi, 
  WifiX, 
  Info, 
  ExternalLink, 
  Clock,
  CheckCircle,
  Warning
} from '@phosphor-icons/react';
import { getConfig } from '../lib/config';
import { NetworkDiagnostics, type DiagnosticResult } from '../lib/diagnostics';

interface ConnectionTroubleshooterProps {
  onConnectionSuccess: () => void;
}

export function ConnectionTroubleshooter({ onConnectionSuccess }: ConnectionTroubleshooterProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'idle' | 'success' | 'failed'>('idle');
  const [diagnostics, setDiagnostics] = useState<DiagnosticResult[]>([]);

  const config = getConfig();

  const runDiagnostics = async () => {
    setTesting(true);
    setTestResult('idle');
    setDiagnostics([]);

    try {
      const results = await NetworkDiagnostics.runDiagnostics(config.BACKEND_URL);
      setDiagnostics(results);
      
      // Check if all critical tests passed
      const criticalTests = results.filter(r => r.test.includes('Health Check') || r.test.includes('Connectivity'));
      const allPassed = criticalTests.every(t => t.status === 'pass');
      
      if (allPassed) {
        setTestResult('success');
        setTimeout(() => {
          onConnectionSuccess();
        }, 1000);
      } else {
        setTestResult('failed');
      }
    } catch (error) {
      setTestResult('failed');
      setDiagnostics([{
        test: 'Diagnostic Runner',
        status: 'fail',
        message: 'Failed to run diagnostics',
        details: error instanceof Error ? error.message : 'Unknown error'
      }]);
    } finally {
      setTesting(false);
    }
  };

  const getIcon = (status: DiagnosticResult['status']) => {
    switch (status) {
      case 'pass': return <CheckCircle className="w-4 h-4 text-accent" />;
      case 'warning': return <Warning className="w-4 h-4 text-yellow-500" />;
      case 'fail': return <Warning className="w-4 h-4 text-destructive" />;
    }
  };

  const openBackendUrl = () => {
    window.open(`${config.BACKEND_URL}/healthz`, '_blank');
  };

  const skipBackendCheck = () => {
    localStorage.setItem('skipBackendCheck', 'true');
    window.location.reload();
  };

  return (
    <div className="h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {testResult === 'success' ? (
              <CheckCircle className="w-5 h-5 text-accent" />
            ) : testResult === 'failed' ? (
              <WifiX className="w-5 h-5 text-destructive" />
            ) : (
              <Wifi className="w-5 h-5 text-muted-foreground" />
            )}
            Backend Connection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              The application needs to connect to the backend service to function properly.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <div className="text-sm font-medium">Backend URL:</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-muted p-2 rounded text-xs break-all">
                {config.BACKEND_URL}
              </code>
              <Button size="sm" variant="outline" onClick={openBackendUrl}>
                <ExternalLink className="w-3 h-3" />
              </Button>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <Button 
              onClick={runDiagnostics} 
              disabled={testing}
              className="w-full"
            >
              {testing ? (
                <>
                  <Clock className="w-4 h-4 mr-2 animate-spin" />
                  Running Diagnostics...
                </>
              ) : (
                <>
                  <Wifi className="w-4 h-4 mr-2" />
                  Test Connection
                </>
              )}
            </Button>

            <button
              type="button"
              onClick={skipBackendCheck}
              className="mt-3 w-full rounded-md bg-gray-200 py-2 text-gray-700 hover:bg-gray-300 transition text-sm font-medium"
            >
              Skip for now (Dev Mode)
            </button>

            {testResult === 'success' && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription className="text-accent">
                  ✓ All tests passed! Redirecting to application...
                </AlertDescription>
              </Alert>
            )}

            {diagnostics.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Diagnostic Results:</h3>
                {diagnostics.map((result, index) => (
                  <div key={index} className="border rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      {getIcon(result.status)}
                      <span className="text-sm font-medium">{result.test}</span>
                      <Badge variant={result.status === 'pass' ? 'secondary' : 'destructive'} className="text-xs">
                        {result.status.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">{result.message}</p>
                    {result.details && (
                      <p className="text-xs bg-muted p-2 rounded font-mono whitespace-pre-wrap">
                        {result.details}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          <div className="text-xs text-muted-foreground space-y-2">
            <p className="font-medium">Common Solutions:</p>
            <ul className="space-y-1 text-xs">
              <li>• <strong>Render Free Tier:</strong> Service may sleep after 15min inactivity</li>
              <li>• <strong>First connection:</strong> Cold start can take 30-60 seconds</li>
              <li>• <strong>CORS errors:</strong> Backend must allow your domain</li>
              <li>• <strong>Service offline:</strong> Check Render dashboard for status</li>
            </ul>
            <p className="mt-2">
              <strong>Your frontend domain:</strong> {window.location.origin}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
