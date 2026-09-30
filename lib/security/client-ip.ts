/**
 * The client IP from X-Forwarded-For, trusting only the entries appended by our
 * own proxies. Each trusted hop appends the address it received the request
 * from, so with `hops` trusted proxies the client is the hops-th entry from the
 * right. Anything further left was supplied by the client and is ignored.
 * With hops = 0 the header is not trusted at all.
 */
export function clientIp(forwardedFor: string | null | undefined, hops: number): string | null {
  if (!forwardedFor || hops < 1) return null;
  const chain = forwardedFor.split(",").map((s) => s.trim()).filter(Boolean);
  const ip = chain.at(-hops);
  return ip && /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
}
