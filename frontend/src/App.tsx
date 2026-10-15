import React, { useState, useEffect, useCallback } from 'react';
import {
  Sidebar,
  NavigationTab,
} from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { CommandCenter } from './components/overview/CommandCenter';
import { OrderDesk } from './components/orders/OrderDesk';
import { OrderDetailDrawer } from './components/orders/OrderDetailDrawer';
import { ProfitBrain } from './components/profit/ProfitBrain';
import { WhatIfSimulator } from './components/simulator/WhatIfSimulator';
import { NdrRescuePanel } from './components/ndr/NdrRescuePanel';
import { AnalyticsView } from './components/analytics/AnalyticsView';
import { SettingsIntegrations } from './components/settings/SettingsIntegrations';
import { DemoWalkthroughModal } from './components/demo/DemoWalkthroughModal';
import { StorefrontCheckout } from './components/checkout/StorefrontCheckout';
import { BatchCsvScorer } from './components/batch/BatchCsvScorer';
import { ToastContainer, ToastMessage } from './components/common/Toast';
import { AuthModal } from './components/auth/AuthModal';
import { AuthPage } from './components/auth/AuthPage';
import {
  fetchCurrentUser,
  getStoredUser,
  clearAuth,
  MerchantUser,
  MerchantProfile,
} from './services/authApi';
import {
  Order,
  DashboardSummary,
  RecommendedActionType,
  OrderStatus,
  TimelineEvent,
} from './types';
import {
  DataSourceMode,
  getDataSourceMode,
  setDataSourceMode,
} from './services/apiClient';
import { fetchDashboardSummary } from './services/dashboardApi';
import {
  fetchAllOrders,
  fetchOrderById,
  recordOrderAction,
  recordOrderLifecycleEvent,
  scoreOrderWithModel,
} from './services/ordersApi';
import { submitNdrRecovery } from './services/ndrApi';
import { demoAdapter } from './services/demoAdapter';
import { Loader2, AlertTriangle } from 'lucide-react';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavigationTab>('overview');
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dataSourceMode, setMode] = useState<DataSourceMode>(getDataSourceMode());
  const [isDemoGuideOpen, setIsDemoGuideOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Merchant Authentication States
  const [currentUser, setCurrentUser] = useState<MerchantUser | null>(getStoredUser());
  const [currentMerchant, setCurrentMerchant] = useState<MerchantProfile | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isGuestMode, setIsGuestMode] = useState(false);

  useEffect(() => {
    fetchCurrentUser().then((data) => {
      if (data) {
        setCurrentUser(data.user);
        setCurrentMerchant(data.merchant);
      }
    });
  }, []);

  const addToast = (
    type: 'success' | 'warning' | 'error' | 'info',
    title: string,
    message?: string
  ) => {
    const id = `toast_${Date.now()}_${Math.random()}`;
    setToasts(prev => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const refreshData = useCallback(async () => {
    try {
      const [sumData, ordersData] = await Promise.all([
        fetchDashboardSummary(),
        fetchAllOrders(),
      ]);
      setSummary(sumData);
      setOrders(ordersData);
      setLoadError(null);
    } catch (err: any) {
      console.error('Failed to load data:', err);
      const message = err.message || 'Unable to sync orders';
      setLoadError(message);
      addToast('error', 'Backend Connection Failed', message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData, dataSourceMode]);

  const handleSelectOrder = (orderId: string) => {
    setSelectedOrderId(orderId);
    setIsDrawerOpen(true);
  };

  const handleOpenProfitBrain = (orderId: string) => {
    setSelectedOrderId(orderId);
    setIsDrawerOpen(false);
    setActiveTab('profit-brain');
  };

  const handleRecordAction = async (
    action: RecommendedActionType,
    notes?: string,
    additionalData?: Record<string, any>
  ) => {
    if (!selectedOrderId) return;
    try {
      const updated = await recordOrderAction(selectedOrderId, action, notes, additionalData);
      setOrders(prev => prev.map(o => (o.id === updated.id ? updated : o)));
      const newSum = await fetchDashboardSummary();
      setSummary(newSum);
      addToast(
        'success',
        'Action Successfully Recorded',
        `Recorded ${action.replace(/_/g, ' ')} for order ${updated.orderNumber}.`
      );
    } catch (err: any) {
      addToast('error', 'Action Failed', err.message || 'Could not record action.');
      throw err;
    }
  };

  const handleRecordEvent = async (
    eventName: string,
    newStatus?: OrderStatus,
    details?: string,
    source?: TimelineEvent['source']
  ) => {
    if (!selectedOrderId) return;
    try {
      const updated = await recordOrderLifecycleEvent(
        selectedOrderId,
        eventName,
        newStatus,
        details,
        source
      );
      setOrders(prev => prev.map(o => (o.id === updated.id ? updated : o)));
      const newSum = await fetchDashboardSummary();
      setSummary(newSum);
      addToast('success', 'Lifecycle Event Logged', `Event: ${eventName}`);
    } catch (err: any) {
      addToast('error', 'Event Recording Failed', err.message);
      throw err;
    }
  };

  const handleSubmitNdrRecovery = async (
    orderId: string,
    actionType: 'REATTEMPT_WITH_TIME' | 'UPDATE_ADDRESS' | 'ALTERNATE_PHONE' | 'APPROVE_RTO',
    data: {
      reattemptDate?: string;
      newAddress?: string;
      alternatePhone?: string;
      remarks?: string;
    }
  ) => {
    try {
      const updated = await submitNdrRecovery(orderId, actionType, data);
      setOrders(prev => prev.map(o => (o.id === updated.id ? updated : o)));
      const newSum = await fetchDashboardSummary();
      setSummary(newSum);
      addToast(
        'success',
        'NDR Recovery Instruction Transmitted',
        `Updated courier instructions for order ${updated.orderNumber}.`
      );
    } catch (err: any) {
      addToast('error', 'NDR Submission Failed', err.message);
      throw err;
    }
  };

  const handleScoreOrderWithModel = async (orderId: string) => {
    try {
      const updated = await scoreOrderWithModel(orderId);
      setOrders(prev => prev.map(o => (o.id === updated.id ? updated : o)));
      const newSum = await fetchDashboardSummary();
      setSummary(newSum);
      const probText = updated.risk.modelProbability !== undefined
        ? `${(updated.risk.modelProbability * 100).toFixed(1)}%`
        : `${updated.risk.riskScore}%`;
      addToast(
        'success',
        'Trained CatBoost Model Evaluated',
        `Order ${updated.orderNumber} evaluated. RTO Risk Probability: ${probText}. Recommendation: ${updated.risk.recommendedAction.replace(/_/g, ' ')}.`
      );
    } catch (err: any) {
      addToast('error', 'Model Scoring Failed', err.message || 'CatBoost inference failed');
      throw err;
    }
  };

  const handleResetDemoData = () => {
    if (dataSourceMode === 'LIVE_BACKEND') {
      addToast(
        'warning',
        'Live Backend Mode',
        'Reset Demo only resets local mock data. Switch to Demo Simulation Mode to use this action; live backend records were not changed.'
      );
      return;
    }
    demoAdapter.resetDemoData();
    refreshData();
    addToast(
      'info',
      'Demo Dataset Reset',
      'All seed records restored to initial pristine state.'
    );
  };

  const handleModeChange = (mode: DataSourceMode) => {
    setMode(mode);
    setDataSourceMode(mode);
  };

  const selectedOrder = orders.find(o => o.id === selectedOrderId);

  if (!currentUser && !isGuestMode) {
    return (
      <>
        <AuthPage
          onAuthSuccess={(user, merch) => {
            setCurrentUser(user);
            setCurrentMerchant(merch);
            addToast('success', `Welcome, ${user.name}!`, 'Merchant credentials active.');
          }}
          onContinueAsGuest={() => {
            setIsGuestMode(true);
            addToast('info', 'Guest Sandbox Mode', 'Exploring dashboard in read-only sandbox mode.');
          }}
        />
        <ToastContainer toasts={toasts} onDismiss={removeToast} />
      </>
    );
  }

  return (
    <div className="flex h-[100dvh] bg-[#f8fafc] text-slate-900 overflow-hidden font-sans">
      {/* Persistent Left Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={tab => {
          setActiveTab(tab);
          setIsDrawerOpen(false);
        }}
        atRiskCount={summary?.ordersAtRiskCount || 0}
        ndrActiveCount={summary?.ndrActiveCount || 0}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Workspace Top Header */}
        <Header
          mode={dataSourceMode}
          onResetDemo={handleResetDemoData}
          onOpenDemoScript={() => setIsDemoGuideOpen(true)}
          searchQuery={searchQuery}
          onSearchChange={q => {
            setSearchQuery(q);
            if (q && activeTab !== 'orders') {
              setActiveTab('orders');
            }
          }}
          currentUser={currentUser}
          currentMerchant={currentMerchant}
          onOpenAuthModal={() => setIsAuthModalOpen(true)}
          onLogout={() => {
            clearAuth();
            setCurrentUser(null);
            setCurrentMerchant(null);
            setIsGuestMode(false);
            addToast('info', 'Signed Out', 'You have been signed out.');
          }}
        />

        {/* Scrollable Viewport */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-6 md:p-8">
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
              <span className="text-xs font-semibold">Initializing RTOGuard Engine...</span>
            </div>
          ) : loadError && dataSourceMode === 'LIVE_BACKEND' ? (
            <div className="max-w-3xl mx-auto mt-12 rounded-2xl border border-rose-200 bg-white p-8 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-rose-50 p-3 text-rose-600">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-bold text-slate-900">Backend connection failed</h2>
                  <p className="mt-2 text-sm text-slate-600">RTOGuard is set to Live Backend mode, but the API request did not complete. The dashboard will not silently replace live data with demo orders.</p>
                  <p className="mt-3 rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700 break-words">{loadError}</p>
                  <p className="mt-3 text-sm text-slate-600">Start the backend on port 8000 and make sure <code>frontend/.env</code> contains <code>VITE_API_BASE_URL=http://localhost:8000/api</code>.</p>
                  <button onClick={() => { setIsLoading(true); refreshData(); }} className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Retry connection</button>
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-7xl mx-auto">
              {activeTab === 'overview' && summary && (
                <CommandCenter
                  summary={summary}
                  orders={orders}
                  onSelectOrder={handleSelectOrder}
                  onNavigateTab={tab => setActiveTab(tab)}
                />
              )}

              {activeTab === 'orders' && (
                <OrderDesk
                  orders={orders}
                  onSelectOrder={handleSelectOrder}
                  selectedOrderId={selectedOrderId || undefined}
                />
              )}

              {activeTab === 'ndr' && (
                <NdrRescuePanel
                  orders={orders}
                  onSelectOrder={handleSelectOrder}
                  onSubmitRecovery={handleSubmitNdrRecovery}
                />
              )}

              {activeTab === 'profit-brain' && (
                <ProfitBrain
                  orders={orders}
                  selectedOrderId={selectedOrderId || undefined}
                  onSelectOrder={id => setSelectedOrderId(id)}
                  onExecuteAction={async (orderId, actionKey) => {
                    setSelectedOrderId(orderId);
                    await handleRecordAction(actionKey, 'Executed from Profit Brain recommendation card.');
                  }}
                />
              )}

              {activeTab === 'simulator' && <WhatIfSimulator />}

              {activeTab === 'analytics' && <AnalyticsView orders={orders} />}

              {activeTab === 'checkout' && (
                <StorefrontCheckout
                  onOrderCreated={() => {
                    refreshData();
                    setActiveTab('orders');
                  }}
                />
              )}

              {activeTab === 'batch' && <BatchCsvScorer />}

              {activeTab === 'settings' && (
                <SettingsIntegrations
                  currentMode={dataSourceMode}
                  onModeChange={handleModeChange}
                  onResetDemoData={handleResetDemoData}
                  currentUser={currentUser}
                  currentMerchant={currentMerchant}
                  onOpenAuthModal={() => setIsAuthModalOpen(true)}
                />
              )}
            </div>
          )}
        </main>
      </div>

      {/* Slide-over Drawer for Order Detail */}
      {isDrawerOpen && selectedOrder && (
        <OrderDetailDrawer
          order={selectedOrder}
          onClose={() => setIsDrawerOpen(false)}
          onOpenProfitBrain={handleOpenProfitBrain}
          onScoreOrder={handleScoreOrderWithModel}
          onRecordAction={handleRecordAction}
          onRecordEvent={handleRecordEvent}
        />
      )}

      {/* Interactive Demo Presentation Modal */}
      <DemoWalkthroughModal
        isOpen={isDemoGuideOpen}
        onClose={() => setIsDemoGuideOpen(false)}
        onNavigateTab={tab => setActiveTab(tab)}
        onSelectOrder={handleSelectOrder}
        onResetDemo={handleResetDemoData}
      />

      {/* Merchant Sign In / Sign Up / Judge Demo Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={(user, merch) => {
          setCurrentUser(user);
          setCurrentMerchant(merch);
          addToast('success', 'Authenticated Successfully', `Welcome to RTOGuardAI, ${user.name}`);
        }}
      />

      {/* Toast Notification Stack */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
};

export default App;
