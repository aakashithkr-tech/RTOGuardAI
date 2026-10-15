import {
  Order,
  DashboardSummary,
  TimelineEvent,
  RecommendedActionType,
  NdrReason,
  OrderStatus
} from '../types';
import { INITIAL_SEED_ORDERS } from '../data/seedOrders';
import { calculateExpectedContribution } from '../utils/calculations';

const STORAGE_KEY = 'rtoguard_demo_orders_v1';
const DEMO_MODE_KEY = 'rtoguard_demo_mode_state';

class DemoAdapter {
  private orders: Order[];

  constructor() {
    this.orders = this.loadOrders();
  }

  private loadOrders(): Order[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      // ignore
    }
    return JSON.parse(JSON.stringify(INITIAL_SEED_ORDERS));
  }

  private saveOrders(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.orders));
    } catch {
      // ignore
    }
  }

  public resetDemoData(): void {
    this.orders = JSON.parse(JSON.stringify(INITIAL_SEED_ORDERS));
    this.saveOrders();
  }

  public getAllOrders(): Order[] {
    return [...this.orders];
  }

  public getOrderById(orderId: string): Order | undefined {
    return this.orders.find(o => o.id === orderId || o.orderNumber === orderId);
  }

  public getDashboardSummary(): DashboardSummary {
    const orders = this.orders;
    const totalOrders = orders.length;
    const codOrdersCount = orders.filter(o => o.paymentMethod === 'COD').length;
    const prepaidOrdersCount = orders.filter(o => o.paymentMethod === 'PREPAID').length;
    const deliveredOrdersCount = orders.filter(o => o.status === 'DELIVERED').length;
    const rtoOrdersCount = orders.filter(o => o.status === 'RTO_DELIVERED' || o.status === 'RTO_INITIATED').length;
    const pendingOrTransitCount = orders.filter(
      o => o.status === 'PENDING' || o.status === 'DISPATCHED' || o.status === 'IN_TRANSIT' || o.status === 'OUT_FOR_DELIVERY'
    ).length;
    const ordersAtRiskCount = orders.filter(o => o.risk.riskCategory === 'HIGH' || o.risk.riskCategory === 'CRITICAL').length;
    const ndrActiveCount = orders.filter(o => o.status === 'NDR_PENDING' || o.status === 'RECOVERY_IN_PROGRESS').length;

    const totalOrderValue = orders.reduce((sum, o) => sum + o.orderValue, 0);
    const estimatedContribution = orders.reduce((sum, o) => {
      if (o.financials.actualContribution !== undefined) {
        return sum + o.financials.actualContribution;
      }
      return sum + o.financials.expectedContribution;
    }, 0);

    const recordedDeliveryCosts = orders.reduce((sum, o) => {
      let cost = o.financials.forwardShippingCost + o.financials.packagingCost;
      if (o.status === 'RTO_DELIVERED' || o.status === 'RTO_INITIATED') {
        cost += o.financials.reverseLogisticsCost;
      }
      return sum + cost;
    }, 0);

    // Estimated RTO protection from actions taken
    const preventedRtoLossEstimated = orders.reduce((sum, o) => {
      if (o.timeline.some(e => e.category === 'ACTION' && e.outcome === 'SUCCESS')) {
        return sum + o.financials.reverseLogisticsCost + 80;
      }
      return sum;
    }, 0);

    return {
      totalOrders,
      codOrdersCount,
      prepaidOrdersCount,
      deliveredOrdersCount,
      pendingOrTransitCount,
      rtoOrdersCount,
      ordersAtRiskCount,
      totalOrderValue,
      estimatedContribution: Math.round(estimatedContribution),
      recordedDeliveryCosts: Math.round(recordedDeliveryCosts),
      preventedRtoLossEstimated: Math.round(preventedRtoLossEstimated),
      ndrActiveCount,
      activeMode: 'DEMO',
    };
  }

  public recordOrderAction(
    orderId: string,
    action: RecommendedActionType,
    notes?: string,
    additionalData?: Record<string, any>
  ): Order {
    const orderIndex = this.orders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) {
      throw new Error(`Order ${orderId} not found in demo database.`);
    }

    const order = { ...this.orders[orderIndex] };
    const now = new Date().toISOString();

    let newEvent: TimelineEvent = {
      id: `evt_demo_${Date.now()}`,
      orderId: order.id,
      timestamp: now,
      eventName: '',
      category: 'ACTION',
      source: 'MERCHANT_MANUAL',
      details: notes || 'Action recorded by merchant.',
      outcome: 'SUCCESS',
    };

    switch (action) {
      case 'REQUEST_ADDRESS_VERIFICATION': {
        newEvent.eventName = 'Address Verification Requested';
        newEvent.details = notes || 'Interactive address enrichment sent via WhatsApp. Buyer requested to verify street & landmark.';
        // If address details were updated:
        if (additionalData?.verifiedAddress) {
          order.customer.addressLine = additionalData.verifiedAddress;
        }
        // Improve risk profile
        order.risk.riskScore = Math.max(25, order.risk.riskScore - 35);
        order.risk.riskCategory = 'MEDIUM';
        order.risk.primaryReason = 'Address verified via interactive bot session';
        order.risk.actionRationale = 'Address enriched. Order is ready to dispatch.';
        order.financials.verificationCost = 8;
        order.financials.expectedContribution = calculateExpectedContribution({
          orderValue: order.financials.orderValue,
          productCost: order.financials.productCost,
          forwardShippingCost: order.financials.forwardShippingCost,
          packagingCost: order.financials.packagingCost,
          codCollectionFee: order.financials.codCollectionFee,
          paymentGatewayFee: order.financials.paymentGatewayFee,
          reverseLogisticsCost: order.financials.reverseLogisticsCost,
          deliveryProbability: 0.85,
          verificationCost: 8,
          incentiveDiscount: 0,
          isPrepaid: order.paymentMethod === 'PREPAID',
        });
        break;
      }

      case 'OFFER_PREPAID_INCENTIVE': {
        newEvent.eventName = 'Prepaid UPI Conversion Link Sent';
        newEvent.details = notes || 'Offer of 5% UPI discount sent via SMS/WhatsApp. Customer confirmed & paid upfront.';
        order.paymentMethod = 'PREPAID';
        order.risk.riskScore = 15;
        order.risk.riskCategory = 'LOW';
        order.risk.primaryReason = 'Prepaid conversion successful. Zero doorstep rejection risk.';
        order.financials.incentiveDiscount = Math.min(100, Math.round(order.orderValue * 0.05));
        order.financials.paymentGatewayFee = Math.round(order.orderValue * 0.018);
        order.financials.codCollectionFee = 0;
        order.financials.expectedContribution = calculateExpectedContribution({
          orderValue: order.financials.orderValue,
          productCost: order.financials.productCost,
          forwardShippingCost: order.financials.forwardShippingCost,
          packagingCost: order.financials.packagingCost,
          codCollectionFee: 0,
          paymentGatewayFee: order.financials.paymentGatewayFee,
          reverseLogisticsCost: order.financials.reverseLogisticsCost,
          deliveryProbability: 0.96,
          verificationCost: 4,
          incentiveDiscount: order.financials.incentiveDiscount,
          isPrepaid: true,
        });
        break;
      }

      case 'CUSTOMER_CONFIRMATION_CALL': {
        newEvent.eventName = 'Customer Intent Confirmed via Phone';
        newEvent.details = notes || 'Customer confirmed purchase on tele-call. Delivery slot accepted.';
        order.risk.riskScore = Math.max(30, order.risk.riskScore - 28);
        order.risk.riskCategory = order.risk.riskScore > 50 ? 'MEDIUM' : 'LOW';
        order.financials.verificationCost = 14;
        break;
      }

      case 'ESCALATE_HUMAN_REVIEW': {
        newEvent.eventName = 'Escalated to Operations Review';
        newEvent.details = notes || 'Order placed on security hold for manager investigation.';
        order.status = 'PENDING';
        break;
      }

      case 'DISPATCH_STANDARD': {
        newEvent.eventName = 'Dispatched to Courier';
        newEvent.category = 'COURIER';
        newEvent.details = notes || 'Order cleared for standard dispatch and handed to logistics hub.';
        order.status = 'DISPATCHED';
        break;
      }

      default:
        newEvent.eventName = `Action Logged: ${action}`;
    }

    order.timeline.unshift(newEvent);
    order.updatedAt = now;
    this.orders[orderIndex] = order;
    this.saveOrders();

    return order;
  }

  public recordLifecycleEvent(
    orderId: string,
    eventName: string,
    newStatus?: OrderStatus,
    details?: string,
    source: TimelineEvent['source'] = 'DEMO_SIMULATOR'
  ): Order {
    const orderIndex = this.orders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) {
      throw new Error(`Order ${orderId} not found.`);
    }

    const order = { ...this.orders[orderIndex] };
    const now = new Date().toISOString();

    if (newStatus) {
      order.status = newStatus;
      if (newStatus === 'DELIVERED') {
        order.financials.actualContribution =
          order.orderValue -
          order.financials.productCost -
          order.financials.forwardShippingCost -
          order.financials.packagingCost -
          (order.paymentMethod === 'PREPAID'
            ? order.financials.paymentGatewayFee
            : order.financials.codCollectionFee) -
          order.financials.verificationCost -
          order.financials.incentiveDiscount;
      } else if (newStatus === 'RTO_DELIVERED') {
        order.financials.actualContribution = -(
          order.financials.forwardShippingCost +
          order.financials.reverseLogisticsCost +
          order.financials.packagingCost +
          order.financials.verificationCost
        );
      }
    }

    const newEvt: TimelineEvent = {
      id: `evt_demo_${Date.now()}`,
      orderId: order.id,
      timestamp: now,
      eventName,
      category: 'LIFECYCLE',
      source,
      details: details || `Status changed to ${newStatus || 'updated'}`,
      outcome: 'SUCCESS',
    };

    order.timeline.unshift(newEvt);
    order.updatedAt = now;
    this.orders[orderIndex] = order;
    this.saveOrders();

    return order;
  }

  public recordNdrRecovery(
    orderId: string,
    actionType: 'REATTEMPT_WITH_TIME' | 'UPDATE_ADDRESS' | 'ALTERNATE_PHONE' | 'APPROVE_RTO',
    data: {
      reattemptDate?: string;
      newAddress?: string;
      alternatePhone?: string;
      remarks?: string;
    }
  ): Order {
    const orderIndex = this.orders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) {
      throw new Error(`Order ${orderId} not found.`);
    }

    const order = { ...this.orders[orderIndex] };
    const now = new Date().toISOString();

    if (!order.ndr) {
      order.ndr = {
        ndrReason: 'CUSTOMER_UNREACHABLE',
        attemptNumber: 1,
        maxAttemptsAllowed: 3,
        lastAttemptAt: now,
        courierName: 'Delhivery Surface',
        courierRemarks: 'Initial attempt unfulfilled',
        courierAwb: 'AWB-DEMO-991',
        recoveryStatus: 'PENDING_ACTION',
      };
    }

    let eventTitle = '';
    let eventDetails = '';

    if (actionType === 'REATTEMPT_WITH_TIME') {
      order.status = 'RECOVERY_IN_PROGRESS';
      order.ndr.recoveryStatus = 'REATTEMPT_SCHEDULED';
      order.ndr.recoveryActionTaken = `Reattempt scheduled for ${data.reattemptDate || 'tomorrow 10am-2pm'}`;
      eventTitle = 'NDR Recovery: Reattempt Requested with Courier';
      eventDetails = `Customer requested delivery reattempt on ${data.reattemptDate || 'next business day'}. Courier AWB instructed. Remarks: ${data.remarks || 'Time slot verified'}`;
    } else if (actionType === 'UPDATE_ADDRESS') {
      order.status = 'RECOVERY_IN_PROGRESS';
      order.ndr.recoveryStatus = 'ACTION_SENT';
      if (data.newAddress) {
        order.customer.addressLine = data.newAddress;
      }
      order.ndr.recoveryActionTaken = 'Enriched address provided to carrier';
      eventTitle = 'NDR Recovery: Landmark & Address Corrected';
      eventDetails = `Corrected delivery address passed to courier: "${data.newAddress}". Remarks: ${data.remarks || 'Customer confirmed'}`;
    } else if (actionType === 'ALTERNATE_PHONE') {
      order.status = 'RECOVERY_IN_PROGRESS';
      order.ndr.recoveryStatus = 'ACTION_SENT';
      order.ndr.recoveryActionTaken = `Alternate phone: ${data.alternatePhone}`;
      eventTitle = 'NDR Recovery: Alternate Contact Details Transmitted';
      eventDetails = `Alternate phone number ${data.alternatePhone} attached to shipment manifest.`;
    } else if (actionType === 'APPROVE_RTO') {
      order.status = 'RTO_INITIATED';
      order.ndr.recoveryStatus = 'RTO_APPROVED';
      order.ndr.recoveryActionTaken = 'Merchant approved RTO return';
      eventTitle = 'RTO Return Initiated by Merchant';
      eventDetails = `Merchant marked order non-recoverable to prevent further attempt charges. Package returning to hub. Remarks: ${data.remarks || 'Customer unwilling to take delivery'}`;
    }

    const newEvt: TimelineEvent = {
      id: `evt_demo_${Date.now()}`,
      orderId: order.id,
      timestamp: now,
      eventName: eventTitle,
      category: 'RECOVERY',
      source: 'MERCHANT_MANUAL',
      details: eventDetails,
      outcome: 'SUCCESS',
    };

    order.timeline.unshift(newEvt);
    order.updatedAt = now;
    this.orders[orderIndex] = order;
    this.saveOrders();

    return order;
  }
}

export const demoAdapter = new DemoAdapter();
