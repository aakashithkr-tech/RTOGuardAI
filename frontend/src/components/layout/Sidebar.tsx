import React from 'react';
import {
  LayoutDashboard,
  ShieldAlert,
  LifeBuoy,
  BrainCircuit,
  SlidersHorizontal,
  BarChart3,
  Settings,
  ShieldCheck,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';

export type NavigationTab =
  | 'overview'
  | 'orders'
  | 'ndr'
  | 'profit-brain'
  | 'simulator'
  | 'analytics'
  | 'settings';

interface SidebarProps {
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  atRiskCount: number;
  ndrActiveCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  atRiskCount,
  ndrActiveCount,
}) => {
  const navItems = [
    {
      id: 'overview' as NavigationTab,
      label: 'Command Centre',
      icon: LayoutDashboard,
      badge: null,
      description: 'Executive business KPIs & order queue',
    },
    {
      id: 'orders' as NavigationTab,
      label: 'Order Intelligence',
      icon: ShieldAlert,
      badge: atRiskCount > 0 ? `${atRiskCount} at risk` : null,
      badgeColor: 'bg-rose-100 text-rose-700',
      description: 'Granular assessment & action panel',
    },
    {
      id: 'ndr' as NavigationTab,
      label: 'NDR Rescue',
      icon: LifeBuoy,
      badge: ndrActiveCount > 0 ? `${ndrActiveCount} pending` : null,
      badgeColor: 'bg-amber-100 text-amber-800',
      description: 'Non-delivery recovery desk',
    },
    {
      id: 'profit-brain' as NavigationTab,
      label: 'Profit Brain',
      icon: BrainCircuit,
      badge: 'Core Engine',
      badgeColor: 'bg-indigo-100 text-indigo-700 font-bold',
      description: 'Transparent scenario & profit comparison',
    },
    {
      id: 'simulator' as NavigationTab,
      label: 'What-If Simulator',
      icon: SlidersHorizontal,
      badge: null,
      description: 'Sensitivity testing & margin modeling',
    },
    {
      id: 'analytics' as NavigationTab,
      label: 'Analytics & Trends',
      icon: BarChart3,
      badge: null,
      description: 'Carrier breakdown & RTO leakage',
    },
    {
      id: 'settings' as NavigationTab,
      label: 'Settings & APIs',
      icon: Settings,
      badge: null,
      description: 'Live backend / Demo environment',
    },
  ];

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shrink-0 min-h-screen border-r border-slate-800">
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-800/80 flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div>
          <div className="text-base font-bold text-white tracking-tight flex items-center gap-1.5">
            <span>RTOGuard</span>
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              AI
            </span>
          </div>
          <div className="text-[11px] text-slate-400 font-medium">Profit & Recovery Engine</div>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="px-3 pb-2 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
          Merchant Operations
        </div>
        {navItems.map(item => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`w-full text-left flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all group ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 transition-colors ${
                    isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </div>

              {item.badge && (
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ml-2 ${
                    isActive ? 'bg-white/20 text-white' : item.badgeColor
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Value Protection Callout */}
      <div className="p-4 m-3 rounded-xl bg-slate-800/70 border border-slate-700/60 text-xs">
        <div className="flex items-center gap-2 text-indigo-300 font-semibold mb-1">
          <TrendingUp className="w-3.5 h-3.5" />
          <span>Core Differentiator</span>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Not just risk scoring. We simulate expected profit under each intervention and track recovery outcomes.
        </p>
      </div>

      {/* Footer System Status */}
      <div className="p-4 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span>Risk Scoring Active</span>
        </div>
        <span className="text-slate-500 font-mono">PS7 Hackathon</span>
      </div>
    </aside>
  );
};
