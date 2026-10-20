import type { AccessPolicy, Contact } from "@backlabs/core";

/**
 * Combines what we knew about a contact with what a new event says. A phone
 * the channel verified is kept until another verified phone replaces it: a
 * later event without proof cannot downgrade or change it (ADR 0006).
 */
export function mergeContact(known: Contact | null, latest: Contact): Contact {
	if (!known?.phoneVerified || latest.phoneVerified) return latest;
	return { ...latest, phone: known.phone, phoneVerified: true };
}

export function verifiedPhone(contact: Contact | null): string | undefined {
	return contact?.phoneVerified ? contact.phone : undefined;
}

export type AccessDecision = "allowed" | "verify" | "deny";

export function decideAccess(
	policy: AccessPolicy | undefined,
	contact: Contact | null,
): AccessDecision {
	if (!policy?.allowedPhones) return "allowed";
	const phone = verifiedPhone(contact);
	if (!phone) return "verify";
	return policy.allowedPhones.includes(phone) ? "allowed" : "deny";
}
