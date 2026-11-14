import { config } from "./config.js";

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const auth = Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString("base64");
  const res = await fetch(`${config.paypalApiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function paypalRequest<T>(path: string, body?: unknown): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${config.paypalApiBase}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": crypto.randomUUID(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("PayPal error:", JSON.stringify(data));
    throw new Error(`PayPal request failed: ${res.status}`);
  }
  return data as T;
}

export async function createOrder(amount: string): Promise<{ id: string }> {
  return paypalRequest("/v2/checkout/orders", {
    intent: "CAPTURE",
    application_context: {
      shipping_preference: "NO_SHIPPING", // донат - нічого не доставляємо, адреса доставки не потрібна
      user_action: "PAY_NOW",
    },
    purchase_units: [
      {
        description: "Благодійний внесок",
        amount: { currency_code: config.currency, value: amount },
      },
    ],
  });
}

export interface CaptureResult {
  id: string;
  status: string;
  payer?: { name?: { given_name?: string } };
  purchase_units: { payments: { captures: { id: string; status: string; amount: { value: string; currency_code: string } }[] } }[];
}

export async function captureOrder(orderId: string): Promise<CaptureResult> {
  return paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`);
}

