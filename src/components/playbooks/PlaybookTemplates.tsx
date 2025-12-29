import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChecklistQuestion, SessionType, RegimeType } from '@/types/trading';
import { ArrowRight, Zap, TrendingUp, RotateCcw, Target, Clock } from 'lucide-react';

export interface PlaybookTemplate {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  data: {
    name: string;
    description: string;
    session_filter: SessionType[];
    valid_regimes: RegimeType[];
    symbol_filter: string[];
    checklist_questions: ChecklistQuestion[];
    confirmation_rules: string[];
    invalidation_rules: string[];
    management_rules: string[];
    failure_modes: string[];
    entry_zone_rules?: {
      min_percentile?: number;
      max_percentile?: number;
      require_htf_alignment?: boolean;
    };
    max_r_per_trade?: number;
    max_daily_loss_r?: number;
    max_trades_per_session?: number;
  };
}

const TEMPLATES: PlaybookTemplate[] = [
  {
    id: 'london-rotation',
    name: 'London Rotation',
    description: 'Mean reversion at range extremes during London session',
    icon: <RotateCcw className="w-5 h-5" />,
    data: {
      name: 'London Rotation',
      description: 'Trade rotation setups at range extremes during London session, targeting mean reversion after overnight positioning unwinds.',
      session_filter: ['london'],
      valid_regimes: ['rotational'],
      symbol_filter: ['EURUSD', 'GBPUSD'],
      checklist_questions: [
        { id: crypto.randomUUID(), question: 'Is price at a clear range extreme?', order: 0 },
        { id: crypto.randomUUID(), question: 'Is there evidence of exhaustion?', order: 1 },
        { id: crypto.randomUUID(), question: 'Does the higher timeframe support this direction?', order: 2 },
      ],
      confirmation_rules: [
        'Price reaches 75%+ of previous range',
        'Candlestick rejection pattern forms',
        'Lower timeframe momentum divergence',
      ],
      invalidation_rules: [
        'Break of previous day high/low',
        'Strong continuation candle through level',
        'News event within 30 minutes',
      ],
      management_rules: [
        'Target opposite range extreme',
        'Move stop to entry after 0.5R',
        'Take 50% profit at mean',
      ],
      failure_modes: [
        'Entering without exhaustion signal',
        'Trading during trending regime',
        'Ignoring HTF direction',
      ],
      entry_zone_rules: { min_percentile: 20, max_percentile: 35, require_htf_alignment: true },
      max_r_per_trade: 2,
      max_daily_loss_r: 3,
      max_trades_per_session: 2,
    },
  },
  {
    id: 'ny-reversal',
    name: 'NY AM Reversal',
    description: 'Counter-trend reversals during New York morning session',
    icon: <TrendingUp className="w-5 h-5" />,
    data: {
      name: 'NY AM Reversal',
      description: 'Trade reversals at key levels during NY AM when price overextends from the European session trend.',
      session_filter: ['new_york_am'],
      valid_regimes: ['transitional'],
      symbol_filter: [],
      checklist_questions: [
        { id: crypto.randomUUID(), question: 'Is price at a significant daily level?', order: 0 },
        { id: crypto.randomUUID(), question: 'Is there a clear overextension from London?', order: 1 },
        { id: crypto.randomUUID(), question: 'Is volume confirming the reversal?', order: 2 },
      ],
      confirmation_rules: [
        'Price reaches daily/weekly key level',
        'Clear rejection candle on 15m',
        'Volume spike on rejection',
      ],
      invalidation_rules: [
        'Strong close through reversal level',
        'No follow-through within 2 candles',
        'Break of session high/low',
      ],
      management_rules: [
        'Initial target at London session midpoint',
        'Trail stop using 15m swing points',
        'Exit before NY PM session',
      ],
      failure_modes: [
        'Fighting a strong trend',
        'Entering before confirmation',
        'Not accounting for news',
      ],
      max_r_per_trade: 3,
      max_daily_loss_r: 4,
      max_trades_per_session: 2,
    },
  },
  {
    id: 'breakout-continuation',
    name: 'Breakout Continuation',
    description: 'Trend continuation after clean breakouts',
    icon: <Zap className="w-5 h-5" />,
    data: {
      name: 'Breakout Continuation',
      description: 'Enter on pullbacks after a clean breakout of a significant level, riding the continuation move.',
      session_filter: ['london', 'new_york_am'],
      valid_regimes: ['transitional'],
      symbol_filter: [],
      checklist_questions: [
        { id: crypto.randomUUID(), question: 'Was the breakout clean with strong momentum?', order: 0 },
        { id: crypto.randomUUID(), question: 'Has price pulled back to the breakout level?', order: 1 },
        { id: crypto.randomUUID(), question: 'Is the overall trend supporting this move?', order: 2 },
      ],
      confirmation_rules: [
        'Clean break of structure with momentum',
        'Pullback to breakout level holds',
        'Lower TF shows continuation pattern',
      ],
      invalidation_rules: [
        'Close back below breakout level',
        'Deep pullback exceeding 61.8%',
        'Loss of momentum on retest',
      ],
      management_rules: [
        'Stop below pullback low',
        'Target 1:1.5R extension',
        'Scale out at prior swing high/low',
      ],
      failure_modes: [
        'Entering on weak/choppy breakouts',
        'Chasing without pullback',
        'Not waiting for confirmation',
      ],
      max_r_per_trade: 2,
      max_daily_loss_r: 3,
      max_trades_per_session: 3,
    },
  },
  {
    id: 'asian-range',
    name: 'Asian Range Play',
    description: 'Trade the Asian session range boundaries',
    icon: <Target className="w-5 h-5" />,
    data: {
      name: 'Asian Range Play',
      description: 'Trade reactions at Asian session range boundaries during London open.',
      session_filter: ['london'],
      valid_regimes: ['rotational'],
      symbol_filter: ['USDJPY', 'EURJPY', 'GBPJPY'],
      checklist_questions: [
        { id: crypto.randomUUID(), question: 'Is the Asian range clearly defined?', order: 0 },
        { id: crypto.randomUUID(), question: 'Is price testing the range boundary?', order: 1 },
      ],
      confirmation_rules: [
        'Asian range at least 30 pips',
        'Price reaches range boundary cleanly',
        'Rejection pattern at boundary',
      ],
      invalidation_rules: [
        'Asian range too small (<20 pips)',
        'No clear reaction at boundary',
      ],
      management_rules: [
        'Target opposite range boundary',
        'Move stop to entry at midpoint',
      ],
      failure_modes: [
        'Trading when range is too narrow',
        'Ignoring strong directional bias',
      ],
      entry_zone_rules: { min_percentile: 15, max_percentile: 30 },
      max_r_per_trade: 2,
      max_trades_per_session: 2,
    },
  },
  {
    id: 'session-continuation',
    name: 'Session Continuation',
    description: 'Trade in the direction of the session open momentum',
    icon: <Clock className="w-5 h-5" />,
    data: {
      name: 'Session Continuation',
      description: 'Enter on pullbacks in the direction of strong session opening momentum.',
      session_filter: ['london', 'new_york_am'],
      valid_regimes: ['transitional'],
      symbol_filter: [],
      checklist_questions: [
        { id: crypto.randomUUID(), question: 'Did the session open with clear directional momentum?', order: 0 },
        { id: crypto.randomUUID(), question: 'Is price pulling back to a logical level?', order: 1 },
        { id: crypto.randomUUID(), question: 'Is the pullback orderly (not impulsive)?', order: 2 },
      ],
      confirmation_rules: [
        'Session opens with strong directional move',
        'Orderly pullback to VWAP or key level',
        'Smaller timeframe shows rejection',
      ],
      invalidation_rules: [
        'Pullback extends beyond 50%',
        'Choppy, indecisive price action',
        'Reversal candle pattern',
      ],
      management_rules: [
        'Target session high/low extension',
        'Trail with session VWAP',
      ],
      failure_modes: [
        'Trading in choppy sessions',
        'Entering late in the session',
      ],
      max_r_per_trade: 2,
      max_daily_loss_r: 3,
    },
  },
];

interface PlaybookTemplatesProps {
  onSelectTemplate: (template: PlaybookTemplate['data']) => void;
  onSkip: () => void;
}

export function PlaybookTemplates({ onSelectTemplate, onSkip }: PlaybookTemplatesProps) {
  return (
    <div className="space-y-4">
      <div className="text-center space-y-2">
        <h3 className="font-semibold text-lg">Choose a Template</h3>
        <p className="text-sm text-muted-foreground">
          Start with a proven trading strategy or create from scratch
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {TEMPLATES.map((template) => (
          <Card
            key={template.id}
            className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md group"
            onClick={() => onSelectTemplate(template.data)}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div className="p-2 rounded-lg bg-primary/10 text-primary mb-2">
                  {template.icon}
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <CardTitle className="text-base">{template.name}</CardTitle>
              <CardDescription className="text-xs">
                {template.description}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap gap-1">
                {template.data.session_filter.length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {template.data.session_filter.length} session{template.data.session_filter.length > 1 ? 's' : ''}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  {template.data.confirmation_rules.length} rules
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {template.data.checklist_questions.length} checks
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex justify-center pt-2">
        <Button variant="ghost" onClick={onSkip} className="text-muted-foreground">
          Start from scratch
        </Button>
      </div>
    </div>
  );
}
