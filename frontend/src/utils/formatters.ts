import { RiskCategory, OrderStatus, PaymentMethod, NdrReason } from '../types';

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return isoString;
  }
}

export function formatTimeAgo(isoString: string): string {
  try {
    const past = new Date(isoString).getTime();
    if (!Number.isFinite(past)) return 'recently';
    const diffMin = Math.max(0, Math.round((Date.now() - past) / 60000));

    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return 'recently';
  }
}

export function getRiskBadgeClasses(risk: RiskCategory): {
  bg: string;
  text: string;
  border: string;
  dot: string;
} {
  switch (risk) {
    case 'LOW':
      return {
        bg: 'bg-emerald-50 text-emerald-700',
        text: 'text-emerald-700',
        border: 'border-emerald-200',
        dot: 'bg-emerald-500',
      };
    case 'MEDIUM':
      return {
        bg: 'bg-blue-50 text-blue-700',
        text: 'text-blue-700',
        border: 'border-blue-200',
        dot: 'bg-blue-500',
      };
    case 'HIGH':
      return {
        bg: 'bg-amber-50 text-amber-700',
        text: 'text-amber-700',
        border: 'border-amber-200',
        dot: 'bg-amber-500',
      };
    case 'CRITICAL':
      return {
        bg: 'bg-rose-50 text-rose-700',
        text: 'text-rose-700',
        border: 'border-rose-200',
        dot: 'bg-rose-500',
      };
  }
}

export function getStatusBadgeClasses(status: OrderStatus): {
  bg: string;
  text: string;
  border: string;
} {
  switch (status) {
    case 'DELIVERED':
      return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' };
    case 'DISPATCHED':
    case 'IN_TRANSIT':
    case 'OUT_FOR_DELIVERY':
      return { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200' };
    case 'CONFIRMED':
    case 'PENDING':
      return { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' };
    case 'NDR_PENDING':
      return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' };
    case 'RECOVERY_IN_PROGRESS':
      return { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' };
    case 'RTO_INITIATED':
    case 'RTO_DELIVERED':
      return { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' };
  }
}

export function getNdrReasonLabel(reason: NdrReason): string {
  switch (reason) {
    case 'INCOMPLETE_ADDRESS':
      return 'Incomplete / Missing Address Details';
    case 'CUSTOMER_UNREACHABLE':
      return 'Customer Phone Switched Off / No Answer';
    case 'CUSTOMER_UNAVAILABLE':
      return 'Customer Not Available at Premises';
    case 'DELIVERY_REJECTED':
      return 'Customer Refused Delivery at Doorstep';
    case 'DOORSTEP_RESCHEDULE':
      return 'Customer Requested Delivery Reschedule';
  }
}
