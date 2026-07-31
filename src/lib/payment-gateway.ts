/**
 * Payment Gateway Abstraction — bKash & Nagad (Bangladesh)
 *
 * bKash Merchant API: 3-step flow
 *   1. grant-token  — get bearer token (valid 1h)
 *   2. create-payment — create intent, get bkashURL
 *   3. execute-payment — confirm after redirect
 *
 * Nagad Merchant API: 2-step flow
 *   1. initiate — signed request → get redirectURL
 *   2. verify   — signed request to confirm payment
 *
 * StubProvider: always returns success (development / no credentials)
 */

export interface PaymentInitResult {
  paymentId: string;   // gateway-assigned ID to store in logs
  redirectUrl: string; // where to send the user
}

export interface PaymentVerifyResult {
  success: boolean;
  paymentId: string;
  amount: number;
  transactionId?: string;  // gateway's own transaction reference
  message?: string;
}

export interface PaymentGateway {
  initiate(params: { billId: number; amount: number; callbackUrl: string; merchantRef?: string }): Promise<PaymentInitResult>;
  verify(paymentId: string): Promise<PaymentVerifyResult>;
}

// ─── Environment interface (subset of Env used here) ─────────────────────────
export interface GatewayEnv {
  BKASH_APP_KEY?: string;
  BKASH_APP_SECRET?: string;
  BKASH_USERNAME?: string;
  BKASH_PASSWORD?: string;
  BKASH_BASE_URL?: string;  // defaults to sandbox
  NAGAD_MERCHANT_ID?: string;
  NAGAD_MERCHANT_PRIVATE_KEY?: string;
  NAGAD_BASE_URL?: string;  // defaults to sandbox
}

// ─── bKash Provider ───────────────────────────────────────────────────────────
class BkashProvider implements PaymentGateway {
  private readonly baseUrl: string;
  private readonly appKey: string;
  private readonly appSecret: string;
  private readonly username: string;
  private readonly password: string;

  constructor(env: GatewayEnv) {
    this.baseUrl   = env.BKASH_BASE_URL ?? 'https://tokenized.sandbox.bka.sh/v1.2.0-beta';
    this.appKey    = env.BKASH_APP_KEY!;
    this.appSecret = env.BKASH_APP_SECRET!;
    this.username  = env.BKASH_USERNAME!;
    this.password  = env.BKASH_PASSWORD!;
  }

  /** Step 1: Get bearer token (short-lived, not cached here since Workers are stateless) */
  private async getToken(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/tokenized/checkout/token/grant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        username: this.username,
        password: this.password,
      },
      body: JSON.stringify({ app_key: this.appKey, app_secret: this.appSecret }),
    });
    if (!res.ok) throw new Error(`bKash token grant failed: ${res.status}`);
    const data = await res.json() as { id_token: string };
    return data.id_token;
  }

  async initiate({ billId, amount, callbackUrl }: { billId: number; amount: number; callbackUrl: string }): Promise<PaymentInitResult> {
    const token = await this.getToken();
    const res = await fetch(`${this.baseUrl}/tokenized/checkout/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: token,
        'X-APP-Key': this.appKey,
      },
      body: JSON.stringify({
        mode: '0011',          // checkout
        payerReference: String(billId),
        callbackURL: callbackUrl,
        amount: amount.toFixed(2),
        currency: 'BDT',
        intent: 'sale',
        merchantInvoiceNumber: `INV-${billId}`,
      }),
    });
    if (!res.ok) throw new Error(`bKash create payment failed: ${res.status}`);
    const data = await res.json() as { paymentID: string; bkashURL: string; statusCode: string; statusMessage: string };
    if (data.statusCode !== '0000') throw new Error(`bKash error: ${data.statusMessage}`);
    return { paymentId: data.paymentID, redirectUrl: data.bkashURL };
  }

  async verify(paymentId: string): Promise<PaymentVerifyResult> {
    const token = await this.getToken();
    const res = await fetch(`${this.baseUrl}/tokenized/checkout/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: token,
        'X-APP-Key': this.appKey,
      },
      body: JSON.stringify({ paymentID: paymentId }),
    });
    if (!res.ok) throw new Error(`bKash execute failed: ${res.status}`);
    const data = await res.json() as {
      statusCode: string; statusMessage: string;
      paymentID: string; trxID: string; amount: string;
    };
    return {
      success: data.statusCode === '0000',
      paymentId: data.paymentID,
      amount: parseFloat(data.amount ?? '0'),
      transactionId: data.trxID,
      message: data.statusMessage,
    };
  }
}

// ─── Nagad Provider ───────────────────────────────────────────────────────────
class NagadProvider implements PaymentGateway {
  private readonly baseUrl: string;
  private readonly merchantId: string;
  private readonly privateKey: string;

  constructor(env: GatewayEnv) {
    this.baseUrl    = env.NAGAD_BASE_URL ?? 'https://sandbox.mynagad.com:10080/remote-payment-gateway-1.0';
    this.merchantId = env.NAGAD_MERCHANT_ID!;
    this.privateKey = env.NAGAD_MERCHANT_PRIVATE_KEY!;
  }

  /** Sign data with merchant RSA private key using crypto.subtle (Workers-native) */
  private async sign(data: string): Promise<string> {
    const keyDer = Uint8Array.from(atob(this.privateKey.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      'pkcs8', keyDer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['sign'],
    );
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data));
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
  }

  async initiate({ billId, amount, callbackUrl }: { billId: number; amount: number; callbackUrl: string }): Promise<PaymentInitResult> {
    const datetime = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const orderId = `${this.merchantId}-${billId}-${datetime}`;
    const sensitive = JSON.stringify({
      merchantId: this.merchantId,
      datetime,
      orderId,
      challenge: orderId,
    });
    const sig = await this.sign(sensitive);

    const res = await fetch(`${this.baseUrl}/api/dfs/check-out/initialize/${this.merchantId}/${orderId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-KM-Api-Version': 'v-0.2.0', 'X-KM-IP-V4': '127.0.0.1' },
      body: JSON.stringify({ dateTime: datetime, sensitiveData: btoa(sensitive), signature: sig, merchantCallbackURL: callbackUrl }),
    });
    if (!res.ok) throw new Error(`Nagad initiate failed: ${res.status}`);
    const data = await res.json() as { sensitiveData: string; signature: string; status: string };
    if (data.status !== 'Success') throw new Error(`Nagad error: ${data.status}`);
    const payload = JSON.parse(atob(data.sensitiveData)) as { paymentReferenceId: string; urlPath: string };

    // Step 2: checkout
    const completeBody = JSON.stringify({
      sensitiveData: btoa(JSON.stringify({
        merchantId: this.merchantId, orderId, amount: amount.toFixed(2),
        currencyCode: '050', challenge: payload.paymentReferenceId,
      })),
      signature: await this.sign(JSON.stringify({ merchantId: this.merchantId, orderId, amount: amount.toFixed(2) })),
      merchantCallbackURL: callbackUrl,
    });
    const res2 = await fetch(`${this.baseUrl}/api/dfs/check-out/complete/${payload.paymentReferenceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-KM-Api-Version': 'v-0.2.0', 'X-KM-IP-V4': '127.0.0.1' },
      body: completeBody,
    });
    if (!res2.ok) throw new Error(`Nagad complete failed: ${res2.status}`);
    const data2 = await res2.json() as { callBackUrl: string; paymentReferenceId: string };
    return { paymentId: data2.paymentReferenceId, redirectUrl: data2.callBackUrl };
  }

  async verify(paymentId: string): Promise<PaymentVerifyResult> {
    const res = await fetch(`${this.baseUrl}/api/dfs/verify/payment/${paymentId}`, {
      headers: { 'X-KM-Api-Version': 'v-0.2.0' },
    });
    if (!res.ok) return { success: false, paymentId, amount: 0, message: `HTTP ${res.status}` };
    const data = await res.json() as {
      status: string; issuerPaymentRefNo: string; amount: string; paymentRefId: string;
    };
    return {
      success: data.status === 'Success',
      paymentId: data.paymentRefId ?? paymentId,
      amount: parseFloat(data.amount ?? '0'),
      transactionId: data.issuerPaymentRefNo,
      message: data.status,
    };
  }
}

// ─── Stub Provider (development / missing credentials) ────────────────────────
class StubPaymentProvider implements PaymentGateway {
  async initiate({ billId, amount }: { billId: number; amount: number }): Promise<PaymentInitResult> {
    const id = `stub-${Date.now()}`;
    console.log(`[STUB PAYMENT] initiate billId=${billId} amount=${amount} → paymentId=${id}`);
    return {
      paymentId: id,
      redirectUrl: `http://localhost:8787/api/payments/stub-callback?paymentId=${id}&status=success`,
    };
  }
  async verify(paymentId: string): Promise<PaymentVerifyResult> {
    console.log(`[STUB PAYMENT] verify paymentId=${paymentId} → success`);
    return { success: true, paymentId, amount: 0, transactionId: `TXN-${Date.now()}`, message: 'Stub success' };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────
export type GatewayName = 'bkash' | 'nagad';

export function createPaymentGateway(gateway: GatewayName, env: GatewayEnv): PaymentGateway {
  if (gateway === 'bkash') {
    if (!env.BKASH_APP_KEY || !env.BKASH_APP_SECRET) {
      console.warn('[PAYMENT] bKash credentials missing — using stub');
      return new StubPaymentProvider();
    }
    return new BkashProvider(env);
  }
  if (gateway === 'nagad') {
    if (!env.NAGAD_MERCHANT_ID || !env.NAGAD_MERCHANT_PRIVATE_KEY) {
      console.warn('[PAYMENT] Nagad credentials missing — using stub');
      return new StubPaymentProvider();
    }
    return new NagadProvider(env);
  }
  return new StubPaymentProvider();
}
