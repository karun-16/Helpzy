import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { API_ERROR_CODES, type GatewayMethod } from '@helpzy/types';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { APP_CONFIG, type AppConfigRef } from '../config/app-config.token';

/** A checkout the customer is sent to complete payment with the gateway. */
export interface GatewayCheckout {
  provider: string;
  /** Opaque to the client; the gateway owns what happens after this. */
  checkoutUrl: string;
  gatewayTransactionId: string;
  instrument: GatewayMethod;
  amount: number;
  currency: string;
  expiresAt: Date;
}

/** What a verified gateway callback says happened. */
export interface GatewayEvent {
  providerEventId: string;
  provider: string;
  /** The gateway's reference for the payment attempt, from checkout. */
  gatewayTransactionId: string;
  outcome: 'SUCCEEDED' | 'FAILED' | 'PENDING';
  amount: number;
  currency: string;
  signature: string;
  timestamp: string;
}

/**
 * The payment provider contract.
 *
 * The API depends only on this interface, so swapping sandbox providers is a
 * configuration change. Critically there is **no** "mark as paid" method: a
 * payment becomes paid exclusively through {@link handleWebhook}, which the
 * provider calls server-to-server. That is what makes it impossible for a client
 * to settle its own payment by returning from a redirect.
 */
export interface PaymentGateway {
  readonly name: string;
  /** Whether this provider can actually start a checkout right now. */
  isConfigured(): boolean;
  createCheckout(input: {
    reference: string;
    amount: number;
    currency: string;
    method: GatewayMethod;
    customerEmail: string | null;
  }): Promise<GatewayCheckout>;
  /** Throws when the signature does not verify. */
  verifyWebhook(rawBody: Buffer, signature: string): void;
  parseWebhook(rawBody: Buffer): GatewayEvent;
}

/**
 * Signature verification shared by the sandbox provider and any real one.
 *
 * Uses a constant-time comparison so a signature check cannot be turned into a
 * timing oracle, and fails closed on any length mismatch.
 */
export function verifyHmacSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const received = Buffer.from(signature, 'utf8');
  const computed = Buffer.from(expected, 'utf8');
  if (received.length !== computed.length) return false;
  return timingSafeEqual(received, computed);
}

/**
 * A deterministic sandbox gateway.
 *
 * It creates real checkout sessions with real references and verifies real HMAC
 * signatures, so the whole integration - checkout, callback, idempotency and
 * duplicate protection - is exercised end to end without a vendor account. It
 * performs no network call and moves no money, and it names itself `sandbox` in
 * every response so nothing here can be mistaken for a live gateway.
 */
@Injectable()
export class SandboxPaymentGateway implements PaymentGateway {
  readonly name = 'sandbox';

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfigRef) {}

  isConfigured(): boolean {
    // Sandbox needs only the signing secret, which always has a development
    // default, so it is available in every environment that has a secret at all.
    return Boolean(this.config.paymentWebhookSecret);
  }

  async createCheckout(input: {
    reference: string;
    amount: number;
    currency: string;
    method: GatewayMethod;
    customerEmail: string | null;
  }): Promise<GatewayCheckout> {
    const gatewayTransactionId = `sbx_${randomUUID().replaceAll('-', '')}`;

    // Signed with the same secret the callback is verified against, so the
    // checkout and the callback agree on integrity in local testing.
    const signature = createHmac('sha256', this.config.paymentWebhookSecret)
      .update(`${gatewayTransactionId}:${input.reference}:${input.amount.toFixed(2)}`)
      .digest('hex');

    const checkoutUrl = [
      this.config.paymentSandboxCheckoutBaseUrl,
      `txn=${encodeURIComponent(gatewayTransactionId)}`,
      `ref=${encodeURIComponent(input.reference)}`,
      `amount=${input.amount.toFixed(2)}`,
      `currency=${encodeURIComponent(input.currency)}`,
      `method=${encodeURIComponent(input.method)}`,
      `sig=${encodeURIComponent(signature)}`,
    ].join('&');

    return {
      provider: this.name,
      checkoutUrl,
      gatewayTransactionId,
      instrument: input.method,
      amount: input.amount,
      currency: input.currency,
      // Real gateways expire a checkout; matching that stops the app assuming a
      // session stays valid forever.
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    };
  }

  verifyWebhook(rawBody: Buffer, signature: string): void {
    if (!this.config.paymentWebhookSecret) {
      throw new ServiceUnavailableException({
        code: API_ERROR_CODES.SERVICE_UNAVAILABLE,
        message: 'Payment callbacks are not configured for this environment.',
      });
    }
    if (!verifyHmacSignature(rawBody, signature, this.config.paymentWebhookSecret)) {
      // An unverified callback is refused outright. It is never stored as a
      // "maybe" and reconsidered later.
      throw new ServiceUnavailableException({
        code: API_ERROR_CODES.SERVICE_UNAVAILABLE,
        message: 'The payment callback signature could not be verified.',
      });
    }
  }

  parseWebhook(rawBody: Buffer): GatewayEvent {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new ServiceUnavailableException({
        code: API_ERROR_CODES.SERVICE_UNAVAILABLE,
        message: 'The payment callback was not valid JSON.',
      });
    }

    const outcome = parsed.outcome;
    if (outcome !== 'SUCCEEDED' && outcome !== 'FAILED' && outcome !== 'PENDING') {
      throw new ServiceUnavailableException({
        code: API_ERROR_CODES.SERVICE_UNAVAILABLE,
        message: 'The payment callback did not carry a recognised outcome.',
      });
    }

    return {
      providerEventId: String(parsed.eventId ?? ''),
      provider: this.name,
      gatewayTransactionId: String(parsed.gatewayTransactionId ?? ''),
      outcome,
      amount: Number(parsed.amount ?? 0),
      currency: String(parsed.currency ?? 'INR'),
      signature: String(parsed.signature ?? ''),
      timestamp: String(parsed.timestamp ?? new Date().toISOString()),
    };
  }
}
