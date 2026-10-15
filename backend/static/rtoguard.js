/**
 * RTOGuardAI Client SDK (v1.0.0)
 * Lightweight, dependency-free checkout risk scoring SDK.
 * Size: < 10 KB uncompressed.
 */
(function (global) {
  'use strict';

  var SCRIPT_ATTR_KEY = 'data-key';
  var SCRIPT_ATTR_URL = 'data-api-url';
  var DEFAULT_TIMEOUT_MS = 3000;

  // Determine script tag and auto-configuration
  var currentScript = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      if (scripts[i].src && scripts[i].src.indexOf('rtoguard.js') !== -1) {
        return scripts[i];
      }
    }
    return scripts[scripts.length - 1];
  })();

  var autoKey = currentScript ? currentScript.getAttribute(SCRIPT_ATTR_KEY) : '';
  var scriptOrigin = '';
  if (currentScript && currentScript.src) {
    try {
      var a = document.createElement('a');
      a.href = currentScript.src;
      scriptOrigin = a.protocol + '//' + a.host;
    } catch (e) {}
  }

  var RTOGuard = {
    version: '1.0.0',
    publicKey: autoKey || '',
    apiBaseUrl: (currentScript && currentScript.getAttribute(SCRIPT_ATTR_URL)) || scriptOrigin || window.location.origin,

    /**
     * Explicit configuration method
     */
    init: function (options) {
      options = options || {};
      if (options.key) this.publicKey = options.key;
      if (options.apiBaseUrl) this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, '');
      if (options.autoMountWidget !== false) {
        this.initWidgets();
      }
      return this;
    },

    /**
     * Return a neutral, non-blocking fail-open decision
     */
    _getFallbackDecision: function (reasonMsg) {
      return {
        api_version: 'v1',
        request_id: 'fallback_' + Math.random().toString(36).substring(2, 10),
        tier: 'ALLOW',
        rto_probability: 0.0,
        reasons: [reasonMsg || 'Service temporarily unreachable; checkout allowed without restriction.'],
        recommended_action: 'allow',
        cod_available: true,
        cod_fee_inr: 0,
        prepaid_discount_inr: 0,
        message: 'Standard Cash on Delivery is approved.',
        summary: 'Degraded fallback decision active.',
        degraded: true,
      };
    },

    /**
     * Dispatch decision event to window/document
     */
    _dispatchEvent: function (decision) {
      try {
        var evt = new CustomEvent('rtoguard:decision', {
          detail: decision,
          bubbles: true,
          cancelable: false,
        });
        window.dispatchEvent(evt);
        document.dispatchEvent(evt);
      } catch (e) {
        // Fallback for older browsers
        var legacyEvt = document.createEvent('CustomEvent');
        legacyEvt.initCustomEvent('rtoguard:decision', true, false, decision);
        document.dispatchEvent(legacyEvt);
      }
    },

    /**
     * Score order risk against /v1/score
     */
    score: function (orderData) {
      var self = this;
      orderData = orderData || {};

      var key = self.publicKey;
      if (!key) {
        console.warn('[RTOGuard] Missing public key (data-key or RTOGuard.init({ key: "pk_..." }))');
        var unconfigured = self._getFallbackDecision('SDK unconfigured: missing public key');
        self._dispatchEvent(unconfigured);
        return Promise.resolve(unconfigured);
      }

      var payload = {
        pincode: String(orderData.pincode || '').trim(),
        address_line: String(orderData.address_line || orderData.address || '').trim(),
        order_value: parseFloat(orderData.order_value || orderData.orderValue || 0),
        category: (orderData.category || 'fashion').toLowerCase(),
        is_cod: orderData.is_cod !== undefined ? Boolean(orderData.is_cod) : (orderData.isCod !== undefined ? Boolean(orderData.isCod) : true),
        customer_history: orderData.customer_history || orderData.customerHistory || undefined,
        order_id: orderData.order_id || orderData.orderId || ('web_' + Date.now()),
        customer_id: orderData.customer_id || orderData.customerId || 'CUST_WEB',
      };

      var controller;
      var timeoutId;
      if (typeof AbortController !== 'undefined') {
        controller = new AbortController();
        timeoutId = setTimeout(function () {
          controller.abort();
        }, DEFAULT_TIMEOUT_MS);
      }

      var endpoint = (self.apiBaseUrl ? self.apiBaseUrl.replace(/\/+$/, '') : '') + '/v1/score';

      return fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': key,
        },
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined,
      })
        .then(function (res) {
          if (timeoutId) clearTimeout(timeoutId);
          if (!res.ok) {
            return res.json().catch(function () { return {}; }).then(function (errBody) {
              var errDetail = errBody && errBody.error ? errBody.error.message : ('HTTP ' + res.status);
              console.warn('[RTOGuard] API returned error, failing open: ' + errDetail);
              return self._getFallbackDecision('Server error (' + res.status + '): failing open.');
            });
          }
          return res.json();
        })
        .catch(function (err) {
          if (timeoutId) clearTimeout(timeoutId);
          var isTimeout = err && err.name === 'AbortError';
          console.warn('[RTOGuard] ' + (isTimeout ? 'Request timed out' : 'Network error') + ', failing open.');
          return self._getFallbackDecision(isTimeout ? 'Scoring timed out; failed open.' : 'Network error; failed open.');
        })
        .then(function (decision) {
          self._dispatchEvent(decision);
          return decision;
        });
    },

    /**
     * Automatic Checkout Widget mount on [data-rtoguard-checkout]
     */
    initWidgets: function () {
      var containers = document.querySelectorAll('[data-rtoguard-checkout]');
      for (var i = 0; i < containers.length; i++) {
        this.renderCheckoutWidget(containers[i]);
      }
    },

    /**
     * Render accessible COD/Prepaid selector in element
     */
    renderCheckoutWidget: function (container, options) {
      var self = this;
      if (!container) return;

      options = options || {};
      var pincode = options.pincode || container.getAttribute('data-pincode') || '110001';
      var address = options.address || container.getAttribute('data-address') || 'Sample Address';
      var orderValue = parseFloat(options.orderValue || container.getAttribute('data-order-value') || 1499);
      var category = options.category || container.getAttribute('data-category') || 'fashion';

      container.innerHTML =
        '<div class="rtoguard-widget" style="font-family:system-ui,-apple-system,sans-serif;border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:#ffffff;box-shadow:0 1px 3px rgba(0,0,0,0.05);">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
            '<div style="display:flex;align-items:center;gap:8px;">' +
              '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#6366f1;"></span>' +
              '<strong style="font-size:14px;color:#0f172a;">RTOGuard Smart Checkout</strong>' +
            '</div>' +
            '<span id="rtoguard-badge" style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:#f1f5f9;color:#64748b;">Checking risk...</span>' +
          '</div>' +
          '<div id="rtoguard-msg" style="font-size:12px;color:#475569;margin-bottom:14px;line-height:1.4;">Analyzing order profile for optimal payment options...</div>' +
          '<div role="radiogroup" aria-label="Select Payment Method" style="display:grid;gap:10px;">' +
            '<label id="rtoguard-opt-prepaid" style="display:flex;align-items:center;justify-content:space-between;padding:12px;border:1.5px solid #6366f1;border-radius:8px;cursor:pointer;background:#f8fafc;">' +
              '<span style="display:flex;align-items:center;gap:10px;">' +
                '<input type="radio" name="rtoguard_pay_method" value="PREPAID" checked style="accent-color:#6366f1;">' +
                '<span><strong style="font-size:13px;color:#0f172a;display:block;">Pay Online (UPI / Card / NetBanking)</strong>' +
                '<span id="rtoguard-prepaid-note" style="font-size:11px;color:#16a34a;font-weight:500;">Fast & Secure</span></span>' +
              '</span>' +
              '<span id="rtoguard-prepaid-amount" style="font-size:14px;font-weight:700;color:#0f172a;">â‚¹' + orderValue.toFixed(0) + '</span>' +
            '</label>' +
            '<label id="rtoguard-opt-cod" style="display:flex;align-items:center;justify-content:space-between;padding:12px;border:1.5px solid #cbd5e1;border-radius:8px;cursor:pointer;background:#ffffff;">' +
              '<span style="display:flex;align-items:center;gap:10px;">' +
                '<input type="radio" name="rtoguard_pay_method" value="COD" style="accent-color:#6366f1;">' +
                '<span><strong style="font-size:13px;color:#0f172a;display:block;">Cash on Delivery (COD)</strong>' +
                '<span id="rtoguard-cod-note" style="font-size:11px;color:#64748b;">Pay cash at doorstep</span></span>' +
              '</span>' +
              '<span id="rtoguard-cod-amount" style="font-size:14px;font-weight:700;color:#0f172a;">â‚¹' + orderValue.toFixed(0) + '</span>' +
            '</label>' +
          '</div>' +
        '</div>';

      self.score({
        pincode: pincode,
        address: address,
        orderValue: orderValue,
        category: category,
      }).then(function (decision) {
        var badge = container.querySelector('#rtoguard-badge');
        var msg = container.querySelector('#rtoguard-msg');
        var optCod = container.querySelector('#rtoguard-opt-cod');
        var codInput = optCod ? optCod.querySelector('input') : null;
        var codNote = container.querySelector('#rtoguard-cod-note');
        var prepaidNote = container.querySelector('#rtoguard-prepaid-note');
        var prepaidAmount = container.querySelector('#rtoguard-prepaid-amount');
        var codAmount = container.querySelector('#rtoguard-cod-amount');

        if (msg) msg.textContent = decision.message || decision.summary;

        if (badge) {
          if (decision.tier === 'ALLOW') {
            badge.textContent = 'LOW RISK â€¢ APPROVED';
            badge.style.background = '#dcfce7';
            badge.style.color = '#15803d';
          } else if (decision.tier === 'REVIEW') {
            badge.textContent = 'MEDIUM RISK â€¢ VERIFY';
            badge.style.background = '#fef9c3';
            badge.style.color = '#a16207';
          } else {
            badge.textContent = 'HIGH RISK â€¢ COD DISABLED';
            badge.style.background = '#fee2e2';
            badge.style.color = '#b91c1c';
          }
        }

        if (decision.prepaid_discount_inr > 0) {
          var discounted = Math.max(1, orderValue - decision.prepaid_discount_inr);
          if (prepaidAmount) prepaidAmount.innerHTML = 'â‚¹' + discounted.toFixed(0) + ' <s style="font-size:11px;color:#94a3b8;font-weight:400;">â‚¹' + orderValue.toFixed(0) + '</s>';
          if (prepaidNote) prepaidNote.textContent = 'Instant â‚¹' + decision.prepaid_discount_inr.toFixed(0) + ' discount applied!';
        }

        if (decision.cod_available) {
          if (decision.cod_fee_inr > 0) {
            var withFee = orderValue + decision.cod_fee_inr;
            if (codAmount) codAmount.textContent = 'â‚¹' + withFee.toFixed(0);
            if (codNote) codNote.textContent = '+â‚¹' + decision.cod_fee_inr.toFixed(0) + ' delivery confirmation fee';
          }
        } else {
          // COD Disabled in BLOCK tier
          if (optCod) {
            optCod.style.opacity = '0.5';
            optCod.style.cursor = 'not-allowed';
            optCod.style.background = '#f1f5f9';
            if (codInput) {
              codInput.disabled = true;
              codInput.checked = false;
            }
          }
          if (codNote) codNote.textContent = 'Cash on Delivery unavailable for this address';
          var prepaidRadio = container.querySelector('input[value="PREPAID"]');
          if (prepaidRadio) prepaidRadio.checked = true;
        }

        if (decision.degraded) {
          if (badge) {
            badge.textContent = 'FALLBACK MODE';
            badge.style.background = '#f1f5f9';
            badge.style.color = '#475569';
          }
        }
      });
    },
  };

  // Auto-init widgets on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      RTOGuard.initWidgets();
    });
  } else {
    setTimeout(function () {
      RTOGuard.initWidgets();
    }, 0);
  }

  global.RTOGuard = RTOGuard;
})(typeof window !== 'undefined' ? window : this);
