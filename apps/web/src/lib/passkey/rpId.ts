/**
 * WebAuthn relying-party ID resolution. A passkey only works under the rpId it was created for,
 * and the page's host must equal the rpId or be a subdomain of it.
 */
export type RpIdResult =
  { ok: true; rpId: string } | { ok: false; reason: string };

export function resolveRpId(
  configured: string | undefined,
  hostname: string,
): RpIdResult {
  const host = hostname.toLowerCase();
  const rpId = (configured ?? "").trim().toLowerCase() || host;
  if (!rpId)
    return {
      ok: false,
      reason: "No passkey domain (rpId) could be determined.",
    };
  if (host !== rpId && !host.endsWith(`.${rpId}`)) {
    return {
      ok: false,
      reason: `This page (${host}) is not on the passkey domain ${rpId}. Passkeys created on ${rpId} only work there.`,
    };
  }
  return { ok: true, rpId };
}
