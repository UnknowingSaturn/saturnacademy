import { cn } from "@/lib/utils";

interface ComplianceScoreRingProps {
  completed: number;
  total: number;
  violations: number;
  size?: 'sm' | 'md' | 'lg';
}

export function ComplianceScoreRing({ 
  completed, 
  total, 
  violations,
  size = 'md' 
}: ComplianceScoreRingProps) {
  const percentage = total > 0 ? (completed / total) * 100 : 0;
  
  const sizeConfig = {
    sm: { dimension: 48, strokeWidth: 4, fontSize: 'text-sm' },
    md: { dimension: 64, strokeWidth: 5, fontSize: 'text-lg' },
    lg: { dimension: 80, strokeWidth: 6, fontSize: 'text-xl' },
  };
  
  const config = sizeConfig[size];
  const radius = (config.dimension - config.strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;
  
  // Determine color based on status
  const getColor = () => {
    if (violations > 0) return 'text-loss';
    if (percentage === 100) return 'text-profit';
    if (percentage >= 50) return 'text-warning';
    return 'text-muted-foreground';
  };

  const getStrokeColor = () => {
    if (violations > 0) return 'stroke-loss';
    if (percentage === 100) return 'stroke-profit';
    if (percentage >= 50) return 'stroke-warning';
    return 'stroke-muted-foreground';
  };

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg
        width={config.dimension}
        height={config.dimension}
        className="transform -rotate-90"
      >
        {/* Background Circle */}
        <circle
          cx={config.dimension / 2}
          cy={config.dimension / 2}
          r={radius}
          fill="none"
          strokeWidth={config.strokeWidth}
          className="stroke-muted"
        />
        
        {/* Progress Circle */}
        <circle
          cx={config.dimension / 2}
          cy={config.dimension / 2}
          r={radius}
          fill="none"
          strokeWidth={config.strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn("transition-all duration-500", getStrokeColor())}
        />
      </svg>
      
      {/* Center Text */}
      <div className={cn(
        "absolute inset-0 flex flex-col items-center justify-center",
        config.fontSize,
        getColor()
      )}>
        <span className="font-semibold">{completed}</span>
        <span className="text-[10px] text-muted-foreground">/{total}</span>
      </div>
    </div>
  );
}
