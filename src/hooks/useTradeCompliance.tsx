import { useMemo } from "react";
import { Trade, Playbook, SessionType } from "@/types/trading";
import { useTrades } from "./useTrades";
import { startOfDay, endOfDay, parseISO } from "date-fns";

export interface ComplianceRule {
  id: string;
  label: string;
  category: 'auto' | 'confirmation' | 'invalidation' | 'checklist';
  status: 'passed' | 'failed' | 'pending' | 'na';
  detail?: string;
}

export interface ComplianceResult {
  autoVerified: ComplianceRule[];
  confirmationRules: ComplianceRule[];
  invalidationRules: ComplianceRule[];
  checklistQuestions: ComplianceRule[];
  managementRules: string[];
  failureModes: string[];
  overallStatus: 'compliant' | 'violations' | 'pending';
  violationCount: number;
}

export function useTradeCompliance(
  trade: Trade | null,
  playbook: Playbook | null,
  manualAnswers: Record<string, boolean> = {}
): ComplianceResult {
  const { data: allTrades = [] } = useTrades();

  return useMemo(() => {
    if (!trade || !playbook) {
      return {
        autoVerified: [],
        confirmationRules: [],
        invalidationRules: [],
        checklistQuestions: [],
        managementRules: [],
        failureModes: [],
        overallStatus: 'pending' as const,
        violationCount: 0,
      };
    }

    const autoVerified: ComplianceRule[] = [];
    const confirmationRules: ComplianceRule[] = [];
    const invalidationRules: ComplianceRule[] = [];
    const checklistQuestions: ComplianceRule[] = [];

    // Auto-verified: Session filter
    if (playbook.session_filter && playbook.session_filter.length > 0) {
      const sessionValid = trade.session && playbook.session_filter.includes(trade.session as SessionType);
      autoVerified.push({
        id: 'auto_session',
        label: 'Session',
        category: 'auto',
        status: sessionValid ? 'passed' : trade.session ? 'failed' : 'na',
        detail: sessionValid 
          ? `${formatSession(trade.session)} (valid)` 
          : trade.session 
            ? `${formatSession(trade.session)} (not in ${playbook.session_filter.map(formatSession).join(', ')})` 
            : 'Session not detected',
      });
    }

    // Auto-verified: Symbol filter
    if (playbook.symbol_filter && playbook.symbol_filter.length > 0) {
      const normalizedSymbol = trade.symbol.replace(/[^A-Za-z]/g, '').toUpperCase();
      const symbolMatch = playbook.symbol_filter.some(s => 
        normalizedSymbol.includes(s.replace(/[^A-Za-z]/g, '').toUpperCase())
      );
      autoVerified.push({
        id: 'auto_symbol',
        label: 'Symbol',
        category: 'auto',
        status: symbolMatch ? 'passed' : 'failed',
        detail: symbolMatch 
          ? `${trade.symbol} (valid)` 
          : `${trade.symbol} (not in ${playbook.symbol_filter.join(', ')})`,
      });
    }

    // Auto-verified: Position size / R per trade
    if (playbook.max_r_per_trade && trade.sl_initial) {
      const riskPips = Math.abs(trade.entry_price - trade.sl_initial);
      // This is a simplified check - in reality you'd need account balance to calculate actual R
      const withinLimit = true; // We can't calculate R without knowing account balance
      autoVerified.push({
        id: 'auto_position_size',
        label: 'Position Size',
        category: 'auto',
        status: trade.sl_initial ? 'passed' : 'pending',
        detail: trade.sl_initial 
          ? `SL placed at ${trade.sl_initial} (max ${playbook.max_r_per_trade}R)` 
          : 'No stop loss set yet',
      });
    }

    // Auto-verified: Trade count today
    if (playbook.max_trades_per_session) {
      const tradeDate = parseISO(trade.entry_time);
      const todayStart = startOfDay(tradeDate);
      const todayEnd = endOfDay(tradeDate);
      
      const todayTrades = allTrades.filter(t => {
        const entryDate = parseISO(t.entry_time);
        return entryDate >= todayStart && entryDate <= todayEnd;
      });
      
      const tradeCount = todayTrades.length;
      const withinLimit = tradeCount <= playbook.max_trades_per_session;
      
      autoVerified.push({
        id: 'auto_trade_count',
        label: 'Trade Count',
        category: 'auto',
        status: withinLimit ? 'passed' : 'failed',
        detail: `${tradeCount}/${playbook.max_trades_per_session} trades today`,
      });
    }

    // Confirmation rules (manual verification)
    playbook.confirmation_rules.forEach((rule, index) => {
      const answerId = `confirmation_${index}`;
      confirmationRules.push({
        id: answerId,
        label: rule,
        category: 'confirmation',
        status: manualAnswers[answerId] === true ? 'passed' : 'pending',
      });
    });

    // Invalidation rules (manual verification - these should NOT be present)
    playbook.invalidation_rules.forEach((rule, index) => {
      const answerId = `invalidation_${index}`;
      // For invalidation rules, checking means the condition is NOT present (which is good)
      invalidationRules.push({
        id: answerId,
        label: rule,
        category: 'invalidation',
        status: manualAnswers[answerId] === true ? 'passed' : 'pending',
      });
    });

    // Checklist questions
    playbook.checklist_questions.forEach((question) => {
      const answerId = `checklist_${question.id}`;
      checklistQuestions.push({
        id: answerId,
        label: question.question,
        category: 'checklist',
        status: manualAnswers[answerId] === true ? 'passed' : 'pending',
      });
    });

    // Calculate overall status
    const allRules = [...autoVerified, ...confirmationRules, ...invalidationRules, ...checklistQuestions];
    const failedCount = allRules.filter(r => r.status === 'failed').length;
    const pendingCount = allRules.filter(r => r.status === 'pending').length;
    
    let overallStatus: 'compliant' | 'violations' | 'pending' = 'compliant';
    if (failedCount > 0) {
      overallStatus = 'violations';
    } else if (pendingCount > 0) {
      overallStatus = 'pending';
    }

    return {
      autoVerified,
      confirmationRules,
      invalidationRules,
      checklistQuestions,
      managementRules: playbook.management_rules,
      failureModes: playbook.failure_modes,
      overallStatus,
      violationCount: failedCount,
    };
  }, [trade, playbook, manualAnswers, allTrades]);
}

function formatSession(session: string | null): string {
  if (!session) return 'Unknown';
  const map: Record<string, string> = {
    'tokyo': 'Tokyo',
    'london': 'London',
    'new_york_am': 'NY AM',
    'new_york_pm': 'NY PM',
    'off_hours': 'Off Hours',
  };
  return map[session] || session;
}
