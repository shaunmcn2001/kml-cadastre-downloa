import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ComingSoonViewProps {
  title: string;
  description?: string;
}

export function ComingSoonView({ title, description }: ComingSoonViewProps) {
  return (
    <div className="flex-1 flex items-center justify-center bg-muted/10 p-6">
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>This section is under construction.</p>
          {description && <p>{description}</p>}
          <p className="text-xs text-muted-foreground/70">
            Let us know which datasets or workflows you need and we’ll prioritise them.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
