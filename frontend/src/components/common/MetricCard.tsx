import React from 'react';
import { LucideIcon, Info } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  badgeText?: string;
  badgeType?: 'fact' | 'prediction' | 'estimate' | 'simulation';
  icon: LucideIcon;
  iconBgColor?: string;
  iconColor?: string;
  tooltip?: string;
  trend?: {
    value: string;
    isPositive?: boolean;
    label?: string;
  };
}

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  subValue,
  badgeText,
  badgeType = 'fact',
  icon: Icon,
  iconBgColor = 'bg-slate-100',
  iconColor = 'text-slate-700',
  tooltip,
  trend,
}) => {
  const getBadgeStyle = () => {
    switch (badgeType) {
      case 'fact':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'prediction':
        return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      case 'estimate':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'simulation':
        return 'bg-purple-50 text-purple-700 border-purple-200';
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow relative">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0 pr-3">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              {label}
            </span>
            {tooltip && (
              <div className="group relative cursor-help">
                <Info className="w-3.5 h-3.5 text-slate-400 hover:text-slate-600 transition-colors" />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 hidden group-hover:block w-48 p-2 bg-slate-900 text-white text-[11px] rounded shadow-lg z-20 pointer-events-none text-center">
                  {tooltip}
                </div>
              </div>
            )}
          </div>
          <div className="text-2xl font-bold tracking-tight text-slate-900 mt-1">
            {value}
          </div>
        </div>

        <div className={`p-2.5 rounded-lg ${iconBgColor} ${iconColor} shrink-0`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs pt-2 border-t border-slate-100">
        <div className="text-slate-500 truncate">
          {subValue || (trend ? (
            <span className={trend.isPositive ? 'text-emerald-600 font-medium' : 'text-rose-600 font-medium'}>
              {trend.value} <span className="text-slate-400 font-normal">{trend.label}</span>
            </span>
          ) : 'Active cycle')}
        </div>

        {badgeText && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${getBadgeStyle()}`}>
            {badgeText}
          </span>
        )}
      </div>
    </div>
  );
};
