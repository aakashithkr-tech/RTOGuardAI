import React, { useState } from 'react';
import {
  Sparkles,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  BrainCircuit,
  LifeBuoy,
  ShieldAlert,
  RotateCcw,
  Package,
} from 'lucide-react';
import { Modal } from '../common/Modal';
import { NavigationTab } from '../layout/Sidebar';

interface DemoWalkthroughModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateTab: (tab: NavigationTab) => void;
  onSelectOrder: (orderId: string) => void;
  onResetDemo: () => void;
}

export const DemoWalkthroughModal: React.FC<DemoWalkthroughModalProps> = ({
  isOpen,
  onClose,
  onNavigateTab,
  onSelectOrder,
  onResetDemo,
}) => {
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    {
      title: 'Step 1: The Merchant Command Centre',
      subtitle: 'Identify High-Risk Exposure at a Glance',
      badge: 'Overview',
      content:
        'Start on the Command Centre. Point out the KPI grid distinguishing recorded facts from financial estimates. Show the Order Attention Queue with 2 urgent COD orders having risk scores >60.',
      actionText: 'Go to Command Centre',
      action: () => {
        onNavigateTab('overview');
        onClose();
      },
    },
    {
      title: 'Step 2: Inspect Risky COD Order #RTO-9482',
      subtitle: 'Explainable AI Risk Signals',
      badge: 'Order Intelligence',
      content:
        'Open order RTO-9482. Walk the judges through the explainable risk factors: Missing house/plot number, Tier 3 Muzaffarnagar pincode with 52% historical RTO rate, and high basket size (₹2,499). Show that RTOGuard doesn’t just output a number—it explains why.',
      actionText: 'Open Order RTO-9482',
      action: () => {
        onSelectOrder('ord_101');
        onNavigateTab('orders');
        onClose();
      },
    },
    {
      title: 'Step 3: Profit Brain — The Core Differentiator',
      subtitle: 'Compare Probability-Weighted Scenarios',
      badge: 'Core Engine',
      content:
        'This is the heart of RTOGuard. Show the 5 side-by-side scenarios: Standard Dispatch (Baseline) vs Proactive Address Verification vs Prepaid Conversion. Show how an ₹8 WhatsApp verification protects +₹280 in expected profit by avoiding ₹160 reverse logistics.',
      actionText: 'Launch Profit Brain for RTO-9482',
      action: () => {
        onSelectOrder('ord_101');
        onNavigateTab('profit-brain');
        onClose();
      },
    },
    {
      title: 'Step 4: Execute Action & Simulate Lifecycle',
      subtitle: 'Audit Trail and Event Simulation',
      badge: 'Action Timeline',
      content:
        'Record the Address Verification action. Then simulate "Dispatched" and "Courier Attempt Failed" in the Audit Timeline to demonstrate how the system responds to real-world carrier events.',
      actionText: 'View Audit Timeline',
      action: () => {
        onSelectOrder('ord_101');
        onNavigateTab('orders');
        onClose();
      },
    },
    {
      title: 'Step 5: NDR Rescue & Exception Salvage',
      subtitle: 'Turn Delivery Failures into Realized Revenue',
      badge: 'NDR Rescue',
      content:
        'Navigate to NDR Rescue. Show Order RTO-9340 with an active "Customer Unreachable" carrier event. Submit a structured reattempt window or alternate contact to instruct the courier before the package gets returned to origin.',
      actionText: 'Open NDR Rescue Desk',
      action: () => {
        onNavigateTab('ndr');
        onClose();
      },
    },
    {
      title: 'Step 6: Reset for Next Live Presentation',
      subtitle: 'Pristine Repeatability',
      badge: 'Demo Reliability',
      content:
        'Highlight that RTOGuard works 100% offline or online with zero dependency on external carrier APIs during live presentations. Use the "Reset Demo" button to replay the demo seamlessly.',
      actionText: 'Reset Demo Data Now',
      action: () => {
        onResetDemo();
        onNavigateTab('overview');
        onClose();
      },
    },
  ];

  const s = steps[currentStep];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Judge-Ready Hackathon Demo Guide"
      description="6-Step interactive walkthrough illustrating RTOGuard AI's core value proposition"
      maxWidth="lg"
    >
      <div className="space-y-4">
        {/* Step Indicator */}
        <div className="flex items-center justify-between text-xs font-semibold text-slate-500 pb-2 border-b border-slate-100">
          <span className="text-indigo-600 font-bold uppercase tracking-wider">
            {s.badge}
          </span>
          <span>
            Step {currentStep + 1} of {steps.length}
          </span>
        </div>

        {/* Step Content */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
          <h3 className="text-base font-bold text-slate-900">{s.title}</h3>
          <div className="text-xs font-semibold text-indigo-700 mt-0.5">{s.subtitle}</div>
          <p className="text-xs text-slate-600 mt-2.5 leading-relaxed">{s.content}</p>
        </div>

        {/* Navigation Buttons */}
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))}
            disabled={currentStep === 0}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Previous</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={s.action}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-all"
            >
              <span>{s.actionText}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            {currentStep < steps.length - 1 && (
              <button
                onClick={() => setCurrentStep(prev => prev + 1)}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                Next Step
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};
