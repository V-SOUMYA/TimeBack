// PayPal Orders v2 (sandbox by default). Docs: https://developer.paypal.com/docs/api/orders/v2/

const BASE = process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';

function paypalEnabled() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

let cachedToken = null;
async function getAccessToken() {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  cachedToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

async function paypalFetch(path, body) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`PayPal ${path} failed (${res.status}): ${JSON.stringify(data).slice(0, 400)}`);
  return data;
}

/**
 * Creates one order with a line item per booked service.
 * @param {Array<{name:string, description:string, price:number, sku:string}>} items
 * @param {number} hoursSaved shown in the order description
 */
async function createOrder(items, hoursSaved) {
  const currency = process.env.CURRENCY || 'USD';
  const total = items.reduce((s, i) => s + Math.round(i.price * 100), 0) / 100;
  return paypalFetch('/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: `timeback-${Date.now()}`,
        description: `TimeBack plan: ${hoursSaved} hours freed`.slice(0, 127),
        amount: {
          currency_code: currency,
          value: total.toFixed(2),
          breakdown: { item_total: { currency_code: currency, value: total.toFixed(2) } },
        },
        items: items.map((i) => ({
          name: i.name.slice(0, 127),
          description: i.description.slice(0, 127),
          sku: i.sku,
          quantity: '1',
          category: 'DIGITAL_GOODS',
          unit_amount: { currency_code: currency, value: i.price.toFixed(2) },
        })),
      },
    ],
    application_context: { brand_name: 'TimeBack', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' },
  });
}

async function captureOrder(orderId) {
  return paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`);
}

module.exports = { paypalEnabled, createOrder, captureOrder };
