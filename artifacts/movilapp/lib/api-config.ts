import Constants from 'expo-constants';

function getExpoNetworkHost(): string | null {
  const candidates = [
    Constants.expoConfig?.hostUri,
    Constants.expoGoConfig?.hostUri,
    Constants.manifest2?.extra?.expoClient?.hostUri,
    Constants.manifest?.hostUri,
    Constants.manifest?.debuggerHost,
  ];

  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? candidate.trim() : '';
    if (!value) continue;

    const host = value.split(':')[0].replace(/^\[|\]$/g, '');
    if (!host || /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(host)) {
      continue;
    }

    return host;
  }

  return null;
}

export function getApiBaseUrl(): string {
  const expoHost = getExpoNetworkHost();
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

  if (configured) {
    const normalizedConfigured = configured
      .replace(/\/api\/?$/i, '')
      .replace(/\/+$/, '');

    if (expoHost && /^(https?:\/\/)?(localhost|0\.0\.0\.0|127(?:\.\d{1,3}){3})$/i.test(normalizedConfigured)) {
      return normalizedConfigured.replace(/^(https?:\/\/)(localhost|0\.0\.0\.0|127(?:\.\d{1,3}){3})/i, `$1${expoHost}`);
    }

    return normalizedConfigured;
  }

  const configuredDomain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  const domain = (configuredDomain ?? expoHost ?? 'localhost')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');

  if (!domain) {
    return 'http://localhost';
  }

  const isLocalNetwork =
    /^localhost$/i.test(domain) ||
    /^127(?:\.\d{1,3}){3}$/i.test(domain) ||
    /^0\.0\.0\.0$/i.test(domain) ||
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
