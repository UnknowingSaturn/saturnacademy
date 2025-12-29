import * as React from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Trade } from '@/types/trading';
import { ReportMetrics, ReportPeriod } from '@/hooks/useReports';
import { exportTradesToCSV, exportReportToPDF } from '@/lib/exportUtils';
import { FileDown, FileText, CalendarIcon, Loader2 } from 'lucide-react';
import { format, parseISO, isWithinInterval } from 'date-fns';
import { cn } from '@/lib/utils';
import { DateRange } from 'react-day-picker';

interface ExportControlsProps {
  trades: Trade[];
  metrics: ReportMetrics;
  period: ReportPeriod;
  filteredTrades: Trade[];
}

export const ExportControls = React.forwardRef<HTMLDivElement, ExportControlsProps>(
  function ExportControls({ trades, metrics, period, filteredTrades }, _ref) {
  const [exportingPDF, setExportingPDF] = useState(false);
  const [exportingCSV, setExportingCSV] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  const handleExportPDF = async () => {
    setExportingPDF(true);
    try {
      const filename = `trading-report-${format(period.start, 'yyyy-MM-dd')}.pdf`;
      exportReportToPDF(metrics, period, filteredTrades, filename);
    } finally {
      setExportingPDF(false);
    }
  };

  const handleExportCSV = () => {
    setExportingCSV(true);
    try {
      let tradesToExport = trades.filter(t => !t.is_open);
      
      if (dateRange?.from && dateRange?.to) {
        tradesToExport = tradesToExport.filter(t => {
          const entryDate = parseISO(t.entry_time);
          return isWithinInterval(entryDate, { 
            start: dateRange.from!, 
            end: dateRange.to! 
          });
        });
      }

      const filename = dateRange?.from && dateRange?.to
        ? `trades-${format(dateRange.from, 'yyyy-MM-dd')}-to-${format(dateRange.to, 'yyyy-MM-dd')}.csv`
        : `trades-all-${format(new Date(), 'yyyy-MM-dd')}.csv`;

      exportTradesToCSV(tradesToExport, filename);
    } finally {
      setExportingCSV(false);
    }
  };

  return (
    <Card className="glass-card border-white/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Export Data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* PDF Export */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Export current report as PDF
          </p>
          <Button
            onClick={handleExportPDF}
            disabled={exportingPDF || filteredTrades.length === 0}
            className="w-full gap-2"
            variant="outline"
          >
            {exportingPDF ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            Export Report PDF
          </Button>
        </div>

        {/* CSV Export */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Export trades as CSV (with review data)
          </p>
          
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  'w-full justify-start text-left font-normal',
                  !dateRange && 'text-muted-foreground'
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange?.from ? (
                  dateRange.to ? (
                    <>
                      {format(dateRange.from, 'LLL dd, y')} - {format(dateRange.to, 'LLL dd, y')}
                    </>
                  ) : (
                    format(dateRange.from, 'LLL dd, y')
                  )
                ) : (
                  <span>Select date range (optional)</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                defaultMonth={dateRange?.from}
                selected={dateRange}
                onSelect={setDateRange}
                numberOfMonths={2}
                className="pointer-events-auto"
              />
            </PopoverContent>
          </Popover>

          <Button
            onClick={handleExportCSV}
            disabled={exportingCSV}
            className="w-full gap-2"
            variant="outline"
          >
            {exportingCSV ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
            Export Trades CSV
            {dateRange?.from && dateRange?.to && (
              <span className="text-xs text-muted-foreground ml-1">
                (filtered)
              </span>
            )}
          </Button>

          {dateRange && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDateRange(undefined)}
              className="w-full text-xs text-muted-foreground"
            >
              Clear date filter
            </Button>
          )}
        </div>
        </CardContent>
      </Card>
    );
  }
);
