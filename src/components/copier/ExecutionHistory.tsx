import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { 
  Activity, 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  ArrowUp, 
  ArrowDown, 
  Filter, 
  Calendar as CalendarIcon,
  ChevronDown,
  RefreshCw,
  Loader2
} from 'lucide-react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { useCopierAccounts, useCopierExecutionsRealtime } from '@/hooks/useCopier';
import { cn } from '@/lib/utils';

interface ExecutionFilters {
  receiverAccountId?: string;
  status?: 'success' | 'failed' | 'skipped';
  dateFrom?: Date;
  dateTo?: Date;
}

export const ExecutionHistory = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => {
  const { data: accounts } = useCopierAccounts();
  const receiverAccounts = accounts?.filter(a => a.copier_role === 'receiver') || [];
  
  const [filters, setFilters] = React.useState<ExecutionFilters>({
    dateFrom: subDays(new Date(), 7),
  });
  const [showFilters, setShowFilters] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const pageSize = 25;
  
  const { data: executions, isLoading, refetch, isFetching } = useCopierExecutionsRealtime({
    receiverAccountId: filters.receiverAccountId,
    status: filters.status,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    limit: pageSize,
    offset: page * pageSize,
  });
  
  const handleFilterChange = (key: keyof ExecutionFilters, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value || undefined }));
    setPage(0);
  };
  
  const clearFilters = () => {
    setFilters({ dateFrom: subDays(new Date(), 7) });
    setPage(0);
  };
  
  const hasActiveFilters = filters.receiverAccountId || filters.status || filters.dateTo;
  
  if (isLoading && !executions) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  return (
    <div ref={ref} className="space-y-4" {...props}>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Button
            variant={showFilters ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2"
          >
            <Filter className="h-4 w-4" />
            Filters
            {hasActiveFilters && (
              <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs">
                !
              </Badge>
            )}
          </Button>
          
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear
            </Button>
          )}
        </div>
        
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-2"
        >
          <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>
      
      {/* Filter Panel */}
      {showFilters && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 bg-muted/50 rounded-lg">
          {/* Receiver Account Filter */}
          <div className="space-y-2">
            <Label className="text-xs">Receiver Account</Label>
            <Select
              value={filters.receiverAccountId || 'all'}
              onValueChange={(v) => handleFilterChange('receiverAccountId', v === 'all' ? undefined : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All accounts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All accounts</SelectItem>
                {receiverAccounts.map(acc => (
                  <SelectItem key={acc.id} value={acc.id}>
                    {acc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Status Filter */}
          <div className="space-y-2">
            <Label className="text-xs">Status</Label>
            <Select
              value={filters.status || 'all'}
              onValueChange={(v) => handleFilterChange('status', v === 'all' ? undefined : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {/* Date From */}
          <div className="space-y-2">
            <Label className="text-xs">From Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start font-normal">
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  {filters.dateFrom ? format(filters.dateFrom, 'MMM d, yyyy') : 'Select date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={filters.dateFrom}
                  onSelect={(date) => handleFilterChange('dateFrom', date)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          
          {/* Date To */}
          <div className="space-y-2">
            <Label className="text-xs">To Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start font-normal">
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  {filters.dateTo ? format(filters.dateTo, 'MMM d, yyyy') : 'Now'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={filters.dateTo}
                  onSelect={(date) => handleFilterChange('dateTo', date)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}
      
      {/* Table */}
      {!executions || executions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No execution history yet</p>
          <p className="text-sm">Executions will appear here once the copier is active</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Receiver</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Master Lots</TableHead>
                  <TableHead className="text-right">Receiver Lots</TableHead>
                  <TableHead className="text-right">Slippage</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {executions.map((execution) => {
                  const receiverAccount = receiverAccounts.find(a => a.id === execution.receiver_account_id);
                  
                  return (
                    <TableRow key={execution.id}>
                      <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                        {execution.executed_at 
                          ? format(new Date(execution.executed_at), 'MMM d, HH:mm:ss')
                          : '-'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {receiverAccount?.name || 'Unknown'}
                      </TableCell>
                      <TableCell className="font-medium">{execution.symbol}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {execution.direction === 'buy' ? (
                            <ArrowUp className="h-3 w-3 text-green-500" />
                          ) : (
                            <ArrowDown className="h-3 w-3 text-red-500" />
                          )}
                          <span className={execution.direction === 'buy' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                            {execution.direction.toUpperCase()}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="capitalize">{execution.event_type}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {execution.master_lots?.toFixed(2) || '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {execution.receiver_lots?.toFixed(2) || '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {execution.slippage_pips != null ? (
                          <span className={cn(
                            "font-mono text-sm",
                            execution.slippage_pips > 2 ? 'text-yellow-600 dark:text-yellow-400' : 'text-muted-foreground'
                          )}>
                            {execution.slippage_pips.toFixed(1)} pips
                          </span>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={execution.status} error={execution.error_message} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          
          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {executions.length} executions
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground px-2">
                Page {page + 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => p + 1)}
                disabled={executions.length < pageSize}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
});

ExecutionHistory.displayName = 'ExecutionHistory';

function StatusBadge({ status, error }: { status: string; error?: string | null }) {
  switch (status) {
    case 'success':
      return (
        <Badge className="bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30">
          <CheckCircle className="h-3 w-3 mr-1" />
          Success
        </Badge>
      );
    case 'failed':
      return (
        <Badge 
          className="bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30 cursor-help"
          title={error || undefined}
        >
          <XCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    case 'skipped':
      return (
        <Badge className="bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Skipped
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}
