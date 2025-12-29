import { ChecklistQuestion, SessionType, RegimeType } from '@/types/trading';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PlaybookFormData {
  name: string;
  description: string;
  questions: ChecklistQuestion[];
  sessionFilter: SessionType[];
  validRegimes: RegimeType[];
  symbolFilter: string[];
  confirmationRules: string[];
  invalidationRules: string[];
  managementRules: string[];
  failureModes: string[];
  maxRPerTrade: number | null;
  maxDailyLossR: number | null;
  maxTradesPerSession: number | null;
  entryZoneEnabled: boolean;
}

interface SectionStatus {
  label: string;
  tab: string;
  isComplete: boolean;
  isRecommended: boolean;
  score: number;
  maxScore: number;
  hint?: string;
}

function calculateSectionStatus(data: PlaybookFormData): SectionStatus[] {
  return [
    {
      label: 'Basic',
      tab: 'basic',
      isComplete: !!data.name && data.questions.length >= 1,
      isRecommended: true,
      score: (data.name ? 1 : 0) + (data.description ? 1 : 0) + Math.min(data.questions.length, 3),
      maxScore: 5,
      hint: !data.name ? 'Add a name' : data.questions.length < 2 ? 'Add checklist questions' : undefined,
    },
    {
      label: 'Filters',
      tab: 'filters',
      isComplete: data.sessionFilter.length > 0 || data.validRegimes.length > 0,
      isRecommended: true,
      score: (data.sessionFilter.length > 0 ? 1 : 0) + 
             (data.validRegimes.length > 0 ? 1 : 0) + 
             (data.entryZoneEnabled ? 1 : 0),
      maxScore: 3,
      hint: data.sessionFilter.length === 0 && data.validRegimes.length === 0 
        ? 'Add session or regime filters' 
        : undefined,
    },
    {
      label: 'Rules',
      tab: 'rules',
      isComplete: data.confirmationRules.length >= 1,
      isRecommended: true,
      score: Math.min(data.confirmationRules.length, 3) + 
             Math.min(data.invalidationRules.length, 2) + 
             Math.min(data.managementRules.length, 2),
      maxScore: 7,
      hint: data.confirmationRules.length === 0 ? 'Add confirmation rules' : undefined,
    },
    {
      label: 'Failures',
      tab: 'failures',
      isComplete: data.failureModes.length >= 1,
      isRecommended: true,
      score: Math.min(data.failureModes.length, 3),
      maxScore: 3,
      hint: data.failureModes.length === 0 ? 'Document failure modes' : undefined,
    },
    {
      label: 'Limits',
      tab: 'limits',
      isComplete: data.maxRPerTrade !== null || data.maxDailyLossR !== null,
      isRecommended: false,
      score: (data.maxRPerTrade !== null ? 1 : 0) + 
             (data.maxDailyLossR !== null ? 1 : 0) + 
             (data.maxTradesPerSession !== null ? 1 : 0),
      maxScore: 3,
      hint: undefined,
    },
  ];
}

interface PlaybookProgressProps {
  data: PlaybookFormData;
  onTabChange?: (tab: string) => void;
}

export function PlaybookProgress({ data, onTabChange }: PlaybookProgressProps) {
  const sections = calculateSectionStatus(data);
  const totalScore = sections.reduce((acc, s) => acc + s.score, 0);
  const maxScore = sections.reduce((acc, s) => acc + s.maxScore, 0);
  const percentage = Math.round((totalScore / maxScore) * 100);
  
  const incompleteRecommended = sections.filter(s => s.isRecommended && !s.isComplete);

  return (
    <div className="space-y-3 p-3 border rounded-lg bg-muted/20">
      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">Completeness</span>
          <span className="text-muted-foreground">{percentage}%</span>
        </div>
        <Progress value={percentage} className="h-2" />
      </div>

      {/* Section badges */}
      <div className="flex flex-wrap gap-1.5">
        {sections.map((section) => (
          <Badge
            key={section.tab}
            variant={section.isComplete ? 'default' : 'outline'}
            className={cn(
              'text-xs cursor-pointer transition-colors',
              !section.isComplete && section.isRecommended && 'border-amber-500/50 text-amber-600 dark:text-amber-400'
            )}
            onClick={() => onTabChange?.(section.tab)}
          >
            {section.isComplete ? (
              <CheckCircle2 className="w-3 h-3 mr-1" />
            ) : section.isRecommended ? (
              <AlertCircle className="w-3 h-3 mr-1" />
            ) : null}
            {section.label}
          </Badge>
        ))}
      </div>

      {/* Hint for next step */}
      {incompleteRecommended.length > 0 && incompleteRecommended[0].hint && (
        <p className="text-xs text-muted-foreground">
          💡 {incompleteRecommended[0].hint}
        </p>
      )}
    </div>
  );
}
