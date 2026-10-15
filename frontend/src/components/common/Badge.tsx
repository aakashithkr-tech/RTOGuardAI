import React from 'react';
import { RiskCategory, OrderStatus, PaymentMethod } from '../../types';
import { getRiskBadgeClasses, getStatusBadgeClasses } from '../../utils/formatters';

export const RiskBadge: React.FC<{ risk: RiskCategory; size?: 'sm' | 'md' }> = ({
  risk,
  size = 'md',
}) => {
  const c = getRiskBadgeClasses(risk);
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs font-semibold';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${c.bg} ${c.border} ${sizeClasses}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      <span>{risk} RISK</span>
    </span>
  );
};

export const StatusBadge: React.FC<{ status: OrderStatus; size?: 'sm' | 'md' }> = ({
  status,
  size = 'md',
}) => {
  const c = getStatusBadgeClasses(status);
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs font-semibold';

  const formatStatus = (s: OrderStatus) => {
    switch (s) {
      case 'NDR_PENDING':
        return 'NDR Pending';
      case 'RECOVERY_IN_PROGRESS':
        return 'Recovery Active';
      case 'RTO_INITIATED':
        return 'RTO Initiated';
      case 'RTO_DELIVERED':
        return 'RTO Returned';
      case 'OUT_FOR_DELIVERY':
        return 'Out For Delivery';
      case 'IN_TRANSIT':
        return 'In Transit';
      default:
        return s.charAt(0) + s.slice(1).toLowerCase();
    }
  };

  return (
    <span
      className={`inline-flex items-center rounded-md border font-medium ${c.bg} ${c.text} ${c.border} ${sizeClasses}`}
    >
      {formatStatus(status)}
    </span>
  );
};

export const PaymentBadge: React.FC<{ method: PaymentMethod }> = ({ method }) => {
  const isCod = method === 'COD';
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
        isCod
          ? 'bg-amber-50 text-amber-800 border-amber-200'
          : 'bg-emerald-50 text-emerald-800 border-emerald-200'
      }`}
    >
      {method}
    </span>
  );
};
