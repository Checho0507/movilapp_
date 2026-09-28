import crypto from "node:crypto";

function isConfiguredValue(value: string | undefined) {
  return Boolean(value?.trim() && !/^your_wompi_.*_here$/i.test(value.trim()));
}

export function getWompiWebhookSecret() {
  return (
    process.env["WOMPI_EVENTS_SECRET"]?.trim() ||
    process.env["WOMPI_WEBHOOK_SECRET"]?.trim() ||
    ""
  );
}

export function isWompiCheckoutConfigured() {
  return (
    isConfiguredValue(process.env["WOMPI_PUBLIC_KEY"]) &&
    isConfiguredValue(process.env["WOMPI_INTEGRITY_SECRET"])
  );
}

export function isWompiWebhookConfigured() {
  return isConfiguredValue(getWompiWebhookSecret());
}

export function isWompiConfigured() {
  return isWompiCheckoutConfigured() && isWompiWebhookConfigured();
}

function readPath(payload: unknown, path: string) {
  if (
    path.startsWith("transaction.") &&
    payload &&
    typeof payload === "object" &&
    "data" in payload
  ) {
    return readPath((payload as { data?: unknown }).data, path);
  }

  let value: unknown = payload;
  for (const part of path.split(".")) {
    value = value && typeof value === "object"
      ? (value as Record<string, unknown>)[part]
      : undefined;
  }
  return value == null ? "" : String(value);
}

export function verifyWompiEventSignature(payload: {
  data?: { transaction?: Record<string, unknown> };
  signature?: { properties?: string[]; checksum?: string };
  timestamp?: number;
}) {
  const properties = payload.signature?.properties ?? [];
  const checksum = payload.signature?.checksum?.toLowerCase() ?? "";
  const timestamp = payload.timestamp;
  const secret = getWompiWebhookSecret();

  if (
    !secret ||
    !checksum ||
    !Number.isFinite(timestamp) ||
    properties.length === 0
  ) {
    return false;
  }

  const expected = crypto
    .createHash("sha256")
    .update(`${properties.map(property => readPath(payload, property)).join("")}${timestamp}${secret}`)
    .digest("hex");

  if (expected.length !== checksum.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(checksum));
}

export function createWompiCheckoutUrl({
  amountInCents,
  reference,
  redirectUrl,
}: {
  amountInCents: number;
  reference: string;
  redirectUrl: string;
}) {
  const publicKey = process.env["WOMPI_PUBLIC_KEY"]?.trim();
  const integritySecret = process.env["WOMPI_INTEGRITY_SECRET"]?.trim();

  if (!isWompiCheckoutConfigured() || !publicKey || !integritySecret) {
    throw new Error("Wompi checkout credentials are not configured.");
  }

  const parsedRedirectUrl = new URL(redirectUrl);
  if (process.env["NODE_ENV"] === "production" && parsedRedirectUrl.protocol !== "https:") {
    throw new Error("Wompi redirect URL must use HTTPS in production.");
  }

  const currency = "COP";
  const integritySignature = crypto
    .createHash("sha256")
    .update(`${reference}${amountInCents}${currency}${integritySecret}`)
    .digest("hex");

  const params = new URLSearchParams({
    "public-key": publicKey,
    currency,
    "amount-in-cents": String(amountInCents),
    reference,
    "signature:integrity": integritySignature,
    "redirect-url": redirectUrl,
  });

  return `https://checkout.wompi.co/p/?${params.toString()}`;
}
