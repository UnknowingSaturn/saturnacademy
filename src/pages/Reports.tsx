import { useState } from 'react';
import { useTrades } from '@/hooks/useTrades';
import { useReports, getWeekPeriod, getMonthPeriod, ReportPeriod } from '@/hooks/useReports';
import { AppLayout } from '@/components/layout/AppLayout';
import { ReportMetricsGrid } from '@/components/reports/ReportMetricsGrid';
import { TradeHighlights } from '@/components/reports/TradeHighlights';
import { SymbolBreakdownTable } from '@/components/reports/SymbolBreakdownTable';
import { ExportControls } from '@/components/reports/ExportControls';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChevronLeft, ChevronRight, FileBarChart, Loader2 } from 'lucide-react';
import { addWeeks, subWeeks, addMonths, subMonths } from 'date-fns';

export default function Reports() {
  const { data: trades = [], isLoading } = useTrades();
  const [periodType, setPeriodType] = useState<'week' | 'month'>('week');
  const [currentDate, setCurrentDate] = useState(new Date());

  const period: ReportPeriod = periodType === 'week' 
    ? getWeekPeriod(currentDate) 
    : getMonthPeriod(currentDate);

  const { filteredTrades, metrics } = useReports(trades, period);

  const navigatePrev = () => {
    setCurrentDate(prev => 
      periodType === 'week' ? subWeeks(prev, 1) : subMonths(prev, 1)
    );
  };

  const navigateNext = () => {
    setCurrentDate(prev => 
      periodType === 'week' ? addWeeks(prev, 1) : addMonths(prev, 1)
    );
  };

  const goToCurrentPeriod = () => {
    setCurrentDate(new Date());
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <FileBarChart className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Reports</h1>
              <p className="text-muted-foreground text-sm">
                Performance summaries and data export
              </p>
            </div>
          </div>

          {/* Period Selector */}
          <div className="flex items-center gap-4">
            <Tabs 
              value={periodType} 
              onValueChange={(v) => setPeriodType(v as 'week' | 'month')}
            >
              <TabsList className="glass-card">
                <TabsTrigger value="week">Weekly</TabsTrigger>
                <TabsTrigger value="month">Monthly</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        {/* Period Navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            onClick={navigatePrev}
            className="h-10 w-10"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>

          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-foreground">
              {period.label}
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={goToCurrentPeriod}
              className="text-xs"
            >
              Today
            </Button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={navigateNext}
            className="h-10 w-10"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>

        {/* Metrics Grid */}
        <ReportMetricsGrid metrics={metrics} />

        {/* Main Content */}
        <div className="grid lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3 space-y-6">
            {/* Trade Highlights */}
            <TradeHighlights metrics={metrics} />

            {/* Breakdown Tables */}
            <SymbolBreakdownTable metrics={metrics} />
          </div>

          {/* Sidebar - Export Controls */}
          <div className="space-y-4">
            <ExportControls 
              trades={trades}
              metrics={metrics}
              period={period}
              filteredTrades={filteredTrades}
            />
          </div>
        </div>

        {/* No Data State */}
        {filteredTrades.length === 0 && (
          <div className="text-center py-12">
            <FileBarChart className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">
              No trades for this period
            </h3>
            <p className="text-muted-foreground text-sm">
              Try selecting a different date range or period type.
            </p>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
