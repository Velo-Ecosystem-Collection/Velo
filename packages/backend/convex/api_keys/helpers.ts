type ApiKeyScope = {
  purpose?: "general" | "gas";
};

/** Legacy keys without a purpose retain their original general API access. */
export function canUseGeneralApi(apiKey: ApiKeyScope) {
  return apiKey.purpose === undefined || apiKey.purpose === "general";
}

/** Legacy keys remain valid for Gas; newly created general keys are isolated from it. */
export function canUseGasApi(apiKey: ApiKeyScope) {
  return apiKey.purpose === undefined || apiKey.purpose === "gas";
}
