export function getApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/api\/?$/i, '').replace(/\/+$/, '');
  }

  const domain = (process.env.EXPO_PUBLIC_DOMAIN ?? 'localhost')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');

  if (!domain) {
    return 'http://localhost';
  }

  const isLocalNetwork =
    /^localhost$/i.test(domain) ||
    /^127(?:\.\d{1,3}){3}$/i.test(domain) ||
    /^10(?:\.\d{1,3}){3}$/i.test(domain) ||
    /^192\.168\./i.test(domain) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./i.test(domain) ||
    /^(\d{1,3}\.){3}\d{1,3}$/i.test(domain);

  return `${isLocalNetwork ? 'http' : 'https'}://${domain}`;
}

export function getApiUrl(path = '/api'): string {
  const base = getApiBaseUrl().replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}
