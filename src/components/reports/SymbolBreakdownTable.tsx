import * as React from 'react';
import { ReportMetrics } from '@/hooks/useReports';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { BarChart3 } from 'lucide-react';

interface SymbolBreakdownTableProps {
  metrics: ReportMetrics;
}

export const SymbolBreakdownTable = React.forwardRef<HTMLDivElement, SymbolBreakdownTableProps>(
  function SymbolBreakdownTable({ metrics }, _ref) {
  const symbolData = Object.entries(metrics.tradesBySymbol)
    .sort((a, b) => b[1].pnl - a[1].pnl);

  const sessionData = Object.entries(metrics.tradesBySession)
    .sort((a, b) => b[1].pnl - a[1].pnl);

  const sessionLabels: Record<string, string> = {
    new_york_am: 'New York AM',
    london: 'London',
    tokyo: 'Tokyo',
    new_york_pm: 'New York PM',
    off_hours: 'Off Hours',
    unknown: 'Unknown',
  };

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {/* By Symbol */}
      <Card className="glass-card border-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            Performance by Symbol
          </CardTitle>
        </CardHeader>
        <CardContent>
          {symbolData.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="border-white/5">
                  <TableHead className="text-muted-foreground">Symbol</TableHead>
                  <TableHead className="text-muted-foreground text-center">Trades</TableHead>
                  <TableHead className="text-muted-foreground text-right">P&L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {symbolData.map(([symbol, data]) => (
                  <TableRow key={symbol} className="border-white/5">
                    <TableCell>
                      <Badge variant="outline" className="border-white/10">
                        {symbol}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground">
                      {data.count}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${data.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-4">No data available</p>
          )}
        </CardContent>
      </Card>

      {/* By Session */}
      <Card className="glass-card border-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            Performance by Session
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sessionData.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="border-white/5">
                  <TableHead className="text-muted-foreground">Session</TableHead>
                  <TableHead className="text-muted-foreground text-center">Trades</TableHead>
                  <TableHead className="text-muted-foreground text-right">P&L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessionData.map(([session, data]) => (
                  <TableRow key={session} className="border-white/5">
                    <TableCell className="text-muted-foreground">
                      {sessionLabels[session] || session}
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground">
                      {data.count}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${data.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-4">No data available</p>
          )}
        </CardContent>
        </Card>
      </div>
    );
  }
);
