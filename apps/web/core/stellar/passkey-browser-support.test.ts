import assert from "node:assert/strict";
import test from "node:test";

import { isPasskeyBrowserSupported } from "./passkey-browser-support.ts";

const supportedBrowser = {
  secureContext: true,
  hasPublicKeyCredential: true,
  hasCredentialContainer: true,
};

test("passkey browser support requires WebAuthn in a secure context", () => {
  assert.equal(isPasskeyBrowserSupported(supportedBrowser), true);
  assert.equal(isPasskeyBrowserSupported({ ...supportedBrowser, secureContext: false }), false);
  assert.equal(
    isPasskeyBrowserSupported({ ...supportedBrowser, hasPublicKeyCredential: false }),
    false,
  );
  assert.equal(
    isPasskeyBrowserSupported({ ...supportedBrowser, hasCredentialContainer: false }),
    false,
  );
});
