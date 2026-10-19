import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Chatwoot signs Agent Bot webhooks with HMAC-SHA256 over `${timestamp}.${body}`
 * and sends it as `sha256=<hex>` (lib/webhooks/trigger.rb). The timestamp is
 * part of the signature, so checking its age stops replays.
 */
export function verifySignature(input: {
	secret: string;
	body: string;
	timestamp: string | undefined;
	signature: string | undefined;
	nowSeconds: number;
	toleranceSeconds: number;
}): boolean {
	const { secret, body, timestamp, signature, nowSeconds, toleranceSeconds } =
		input;
	if (!timestamp || !signature) return false;

	const sentAt = Number(timestamp);
	if (!Number.isInteger(sentAt)) return false;
	if (Math.abs(nowSeconds - sentAt) > toleranceSeconds) return false;

	const expected = Buffer.from(
		`sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`,
	);
	const received = Buffer.from(signature);

	return (
		expected.length === received.length && timingSafeEqual(expected, received)
	);
}
