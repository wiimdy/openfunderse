const DEFAULT_REQUIRE_EXPLICIT_SUBMIT = true;
const DEFAULT_AUTO_SUBMIT = false;

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^::1$/,
  /^\[::1\]$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./
];

const envBool = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const envCsv = (name: string): string[] => {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) return [];
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
};

const isPrivateHost = (host: string): boolean => {
  const normalized = host.trim().toLowerCase();
  if (normalized.endsWith('.local')) return true;
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(normalized));
};

export interface StrategySubmitGate {
  submitRequested: boolean;
  autoSubmitEnabled: boolean;
  requireExplicitSubmit: boolean;
  shouldSubmit: boolean;
}

export const resolveStrategySubmitGate = (
  submitRequested: boolean
): StrategySubmitGate => {
  const requireExplicitSubmit = envBool(
    'STRATEGY_REQUIRE_EXPLICIT_SUBMIT',
    DEFAULT_REQUIRE_EXPLICIT_SUBMIT
  );
  const autoSubmitEnabled = envBool('STRATEGY_AUTO_SUBMIT', DEFAULT_AUTO_SUBMIT);

  if (submitRequested && !autoSubmitEnabled) {
    throw new Error(
      'SAFETY_BLOCKED: submit was requested but STRATEGY_AUTO_SUBMIT is disabled. Set STRATEGY_AUTO_SUBMIT=true to allow external submission.'
    );
  }

  return {
    submitRequested,
    autoSubmitEnabled,
    requireExplicitSubmit,
    shouldSubmit: submitRequested || (!requireExplicitSubmit && autoSubmitEnabled)
  };
};

export const strategyTrustedRelayerHosts = (): string[] => {
  return envCsv('STRATEGY_TRUSTED_RELAYER_HOSTS');
};

export const validateStrategyRelayerUrl = (rawUrl: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`RELAYER_URL is invalid: ${rawUrl}`);
  }

  const host = parsed.hostname.trim().toLowerCase();
  const allowHttp = envBool('STRATEGY_ALLOW_HTTP_RELAYER', false);
  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    throw new Error(
      'RELAYER_URL must use https (set STRATEGY_ALLOW_HTTP_RELAYER=true only for local development)'
    );
  }

  const trustedHosts = strategyTrustedRelayerHosts();
  if (trustedHosts.length > 0 && !trustedHosts.includes(host)) {
    throw new Error(`RELAYER_URL host is not in STRATEGY_TRUSTED_RELAYER_HOSTS: host=${host}`);
  }

  if (trustedHosts.length === 0 && isPrivateHost(host) && parsed.protocol === 'https:') {
    throw new Error(
      'RELAYER_URL points to a private/local host over https. Configure STRATEGY_TRUSTED_RELAYER_HOSTS explicitly.'
    );
  }
};
