import Constants from 'expo-constants';

function getExpoNetworkHost(): string | null {
  const candidates = [
    Constants.expoConfig?.hostUri,
    Constants.expoGoConfig?.hostUri,
    Constants.manifest2?.extra?.expoClient?.hostUri,
    Constants.manifest?.hostUri,
    Constants.manifest?.debuggerHost,
    process.env.REACT_NATIVE_PACKAGER_HOSTNAME,
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

function normalizeApiBaseUrl(value: string, fallbackHost?: string | null): string {
  const withoutTrailingSlash = value.replace(/\/api\/?$/i, '').replace(/\/+$/, '');
  const trimmed = withoutTrailingSlash.trim();

  if (!trimmed) {
    return fallbackHost ? `http://${fallbackHost}` : 'http://localhost';
  }

  const localHostMatch = /^(https?:\/\/)?(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0)(?::\d+)?$/i;
  if (localHostMatch.test(trimmed)) {
    const targetHost = fallbackHost ?? 'localhost';
    const protocol = trimmed.startsWith('https://') ? 'https' : 'http';
    const port = trimmed.match(/:(\d+)$/)?.[1] ?? '3000';
    return `${protocol}://${targetHost}:${port}`;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(trimmed) || /^\w[\w.-]*$/i.test(trimmed)) {
    return `http://${trimmed}`;
  }

  return trimmed;
}

function normalizeRuntimeDomain(domain: string | null): string | null {
  if (!domain) return null;

  const withoutProtocol = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const host = withoutProtocol.split(':')[0].replace(/^\[|\]$/g, '');

  if (!host || /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(host)) {
    return null;
  }

  return host;
}

export function getApiBaseUrl(): string {
  const expoHost = getExpoNetworkHost();
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

  if (configured) {
    return normalizeApiBaseUrl(
      configured,
      expoHost ?? normalizeRuntimeDomain(process.env.REACT_NATIVE_PACKAGER_HOSTNAME ?? null),
    );
  }

  const configuredDomain = normalizeRuntimeDomain(process.env.EXPO_PUBLIC_DOMAIN?.trim() ?? null) ?? expoHost;
  const domain = configuredDomain ?? 'localhost';

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

export function getMapTileUrl(): string {
  const base = __DEV__ ? 'http://127.0.0.1:3000' : getApiBaseUrl().replace(/\/+$/, '');
  return `${base}/api/map-tiles/{z}/{x}/{y}.png`;
}
