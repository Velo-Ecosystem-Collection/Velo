export type PasskeyBrowserEnvironment = {
  secureContext: boolean;
  hasPublicKeyCredential: boolean;
  hasCredentialContainer: boolean;
};

function detectPasskeyBrowserEnvironment(): PasskeyBrowserEnvironment | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  return {
    secureContext: window.isSecureContext,
    hasPublicKeyCredential: "PublicKeyCredential" in window,
    hasCredentialContainer: Boolean(navigator.credentials),
  };
}

export function isPasskeyBrowserSupported(environment = detectPasskeyBrowserEnvironment()) {
  return (
    environment !== null &&
    environment.secureContext &&
    environment.hasPublicKeyCredential &&
    environment.hasCredentialContainer
  );
}
