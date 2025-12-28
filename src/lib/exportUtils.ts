import { Trade } from '@/types/trading';
import { format, parseISO } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ReportMetrics, ReportPeriod } from '@/hooks/useReports';

export function exportTradesToCSV(trades: Trade[], filename: string = 'trades-export.csv') {
  const headers = [
    'Date',
    'Symbol',
    'Direction',
    'Entry Price',
    'Exit Price',
    'Lots',
    'Net P&L',
    'R-Multiple',
    'Session',
    'Duration (min)',
    'Commission',
    'Swap',
    'SL Initial',
    'TP Initial',
    'Reviewed',
    'Score',
  ];

  const rows = trades.map(trade => [
    format(parseISO(trade.entry_time), 'yyyy-MM-dd HH:mm'),
    trade.symbol,
    trade.direction.toUpperCase(),
    trade.entry_price.toString(),
    trade.exit_price?.toString() || '',
    trade.total_lots.toString(),
    trade.net_pnl?.toFixed(2) || '',
    trade.r_multiple_actual?.toFixed(2) || '',
    trade.session || '',
    trade.duration_seconds ? Math.round(trade.duration_seconds / 60).toString() : '',
    trade.commission?.toString() || '0',
    trade.swap?.toString() || '0',
    trade.sl_initial?.toString() || '',
    trade.tp_initial?.toString() || '',
    trade.review ? 'Yes' : 'No',
    trade.review?.score?.toString() || '',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
  ].join('\n');

  downloadFile(csvContent, filename, 'text/csv');
}

export function exportReportToPDF(
  metrics: ReportMetrics,
  period: ReportPeriod,
  trades: Trade[],
  filename: string = 'trading-report.pdf'
) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  
  // Header
  doc.setFontSize(24);
  doc.setTextColor(40, 40, 40);
  doc.text('Trading Report', pageWidth / 2, 25, { align: 'center' });
  
  doc.setFontSize(14);
  doc.setTextColor(100, 100, 100);
  doc.text(period.label, pageWidth / 2, 35, { align: 'center' });

  // Summary metrics
  doc.setFontSize(16);
  doc.setTextColor(40, 40, 40);
  doc.text('Performance Summary', 14, 50);

  const summaryData = [
    ['Total Trades', metrics.totalTrades.toString()],
    ['Win Rate', `${metrics.winRate.toFixed(1)}%`],
    ['Profit Factor', metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)],
    ['Total P&L', `$${metrics.totalPnl.toFixed(2)}`],
    ['Avg R-Multiple', metrics.avgRMultiple.toFixed(2)],
    ['Trading Days', metrics.tradingDays.toString()],
    ['Avg Trades/Day', metrics.avgTradesPerDay.toFixed(1)],
  ];

  autoTable(doc, {
    startY: 55,
    head: [['Metric', 'Value']],
    body: summaryData,
    theme: 'striped',
    headStyles: { fillColor: [30, 30, 30] },
    margin: { left: 14, right: 14 },
  });

  // Win/Loss stats
  const lastY = (doc as any).lastAutoTable.finalY || 100;
  doc.setFontSize(16);
  doc.text('Win/Loss Analysis', 14, lastY + 15);

  const winLossData = [
    ['Avg Win', `$${metrics.avgWin.toFixed(2)}`],
    ['Avg Loss', `$${metrics.avgLoss.toFixed(2)}`],
    ['Largest Win', `$${metrics.largestWin.toFixed(2)}`],
    ['Largest Loss', `$${metrics.largestLoss.toFixed(2)}`],
    ['Max Consecutive Wins', metrics.consecutiveWins.toString()],
    ['Max Consecutive Losses', metrics.consecutiveLosses.toString()],
  ];

  autoTable(doc, {
    startY: lastY + 20,
    head: [['Metric', 'Value']],
    body: winLossData,
    theme: 'striped',
    headStyles: { fillColor: [30, 30, 30] },
    margin: { left: 14, right: 14 },
  });

  // Symbol breakdown
  const lastY2 = (doc as any).lastAutoTable.finalY || 150;
  
  if (Object.keys(metrics.tradesBySymbol).length > 0) {
    doc.setFontSize(16);
    doc.text('Performance by Symbol', 14, lastY2 + 15);

    const symbolData = Object.entries(metrics.tradesBySymbol)
      .sort((a, b) => b[1].pnl - a[1].pnl)
      .map(([symbol, data]) => [
        symbol,
        data.count.toString(),
        `$${data.pnl.toFixed(2)}`,
      ]);

    autoTable(doc, {
      startY: lastY2 + 20,
      head: [['Symbol', 'Trades', 'P&L']],
      body: symbolData,
      theme: 'striped',
      headStyles: { fillColor: [30, 30, 30] },
      margin: { left: 14, right: 14 },
    });
  }

  // Best/Worst trades
  doc.addPage();
  doc.setFontSize(16);
  doc.text('Trade Highlights', 14, 25);

  if (metrics.bestTrade) {
    doc.setFontSize(12);
    doc.setTextColor(0, 150, 0);
    doc.text('Best Trade:', 14, 35);
    doc.setTextColor(40, 40, 40);
    doc.text(
      `${metrics.bestTrade.symbol} ${metrics.bestTrade.direction.toUpperCase()} - $${metrics.bestTrade.net_pnl?.toFixed(2)} (${format(parseISO(metrics.bestTrade.entry_time), 'MMM d, yyyy')})`,
      14, 42
    );
  }

  if (metrics.worstTrade) {
    doc.setFontSize(12);
    doc.setTextColor(200, 0, 0);
    doc.text('Worst Trade:', 14, 55);
    doc.setTextColor(40, 40, 40);
    doc.text(
      `${metrics.worstTrade.symbol} ${metrics.worstTrade.direction.toUpperCase()} - $${metrics.worstTrade.net_pnl?.toFixed(2)} (${format(parseISO(metrics.worstTrade.entry_time), 'MMM d, yyyy')})`,
      14, 62
    );
  }

  // Trade list
  doc.setFontSize(16);
  doc.setTextColor(40, 40, 40);
  doc.text('All Trades', 14, 80);

  const tradeData = trades.slice(0, 50).map(trade => [
    format(parseISO(trade.entry_time), 'MM/dd HH:mm'),
    trade.symbol,
    trade.direction.toUpperCase(),
    `$${trade.net_pnl?.toFixed(2) || '0.00'}`,
    trade.r_multiple_actual?.toFixed(2) || '-',
  ]);

  autoTable(doc, {
    startY: 85,
    head: [['Date', 'Symbol', 'Dir', 'P&L', 'R']],
    body: tradeData,
    theme: 'striped',
    headStyles: { fillColor: [30, 30, 30] },
    margin: { left: 14, right: 14 },
    styles: { fontSize: 8 },
  });

  // Footer
  const pageCount = doc.internal.pages.length - 1;
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `Generated on ${format(new Date(), 'MMM d, yyyy HH:mm')} | Page ${i} of ${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' }
    );
  }

  doc.save(filename);
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
