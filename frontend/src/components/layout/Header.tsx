import React from 'react';
import {
  RotateCcw,
  Sparkles,
  Search,
  Bell,
  Store,
  CheckCircle2,
  HelpCircle,
} from 'lucide-react';
import { DataSourceMode } from '../../services/apiClient';

interface HeaderProps {
  mode: DataSourceMode;
  onResetDemo: () => void;
  onOpenDemoScript: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  mode,
  onResetDemo,
  onOpenDemoScript,
  searchQuery,
  onSearchChange,
}) => {
  return (
    <header className="min-h-16 bg-white border-b border-slate-200 px-2 sm:px-6 py-2 flex items-center justify-between gap-2 sticky top-0 z-30">
      <div className="flex items-center gap-2 sm:gap-4 min-w-0">
        {/* Store selector / context */}
        <div className="flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs min-w-0">
          <Store className="w-3.5 h-3.5 text-indigo-600" />
          <span className="font-semibold text-slate-800 truncate">Zenith D2C</span>
          <span className="hidden sm:inline text-slate-400">|</span>
          <span className="hidden sm:inline text-slate-500 font-mono">₹ INR Storefront</span>
          <span className="h-2 w-2 rounded-full bg-emerald-500" title="Webhooks active" />
        </div>

        {/* Search input */}
        <div className="relative w-72 hidden md:block">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search order #, customer, pincode..."
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-800 placeholder-slate-400"
          />
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-3 shrink-0">
        {/* Visible Demo Mode Indicator */}
        {mode === 'DEMO_MOCK' ? (
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-purple-50 border border-purple-200 text-purple-700 text-xs font-medium">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-600"></span>
            </span>
            <span className="hidden sm:inline">Simulated Hackathon Demo</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Live Backend Mode</span>
          </div>
        )}

        {/* Demo Script Walkthrough button */}
        <button
          onClick={onOpenDemoScript}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold transition-all shadow-sm"
          title="Open Judge-Ready Demo Workflow Script"
        >
          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
          <span className="hidden md:inline">Demo Guide</span>
        </button>

        {/* Reset Demo State button */}
        <button
          onClick={onResetDemo}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 text-xs font-medium transition-colors"
          title="Reset Seed Data to Initial State"
        >
          <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
          <span className="hidden lg:inline">Reset Demo</span>
        </button>

        <div className="h-5 w-px bg-slate-200 mx-1 hidden sm:block" />

        {/* Operator Profile */}
        <div className="flex items-center gap-2 pl-1">
          <div className="h-8 w-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-semibold text-xs shadow-sm">
            SM
          </div>
          <div className="hidden lg:block text-left">
            <div className="text-xs font-semibold text-slate-800 leading-none">Ops Lead</div>
            <div className="text-[10px] text-slate-500 leading-none mt-1">Merchant Admin</div>
          </div>
        </div>
      </div>
    </header>
  );
};
