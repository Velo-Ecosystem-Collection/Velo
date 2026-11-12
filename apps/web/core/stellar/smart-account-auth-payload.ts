import { xdr } from "@stellar/stellar-sdk";

export function isSignedSmartAccountAuthPayload(signature: xdr.ScVal) {
  if (signature.switch().name !== "scvMap") return false;

  const fields = signature.map() ?? [];
  if (fields.length !== 2) return false;
  let contextRuleIds: xdr.ScVal | undefined;
  let signers: xdr.ScVal | undefined;
  const fieldNames = new Set<string>();
  for (const field of fields) {
    if (field.key().switch().name !== "scvSymbol") return false;
    const key = field.key().sym().toString();
    if (fieldNames.has(key)) return false;
    fieldNames.add(key);
    if (key === "context_rule_ids") contextRuleIds = field.val();
    else if (key === "signers") signers = field.val();
    else return false;
  }

  if (
    contextRuleIds?.switch().name !== "scvVec" ||
    signers?.switch().name !== "scvMap" ||
    (contextRuleIds.vec()?.length ?? 0) === 0 ||
    (signers.map()?.length ?? 0) === 0
  ) {
    return false;
  }

  const hasValidContextRuleIds = (contextRuleIds.vec() ?? []).every(
    (ruleId) => ruleId.switch().name === "scvU32",
  );
  const hasSignerBytes = (signers.map() ?? []).every(
    (signer) =>
      signer.key().switch().name === "scvVec" &&
      signer.val().switch().name === "scvBytes" &&
      signer.val().bytes().length > 0,
  );
  return hasValidContextRuleIds && hasSignerBytes;
}

export function isSignedSmartAccountAuthorization(signature: xdr.ScVal) {
  if (signature.switch().name === "scvVec") return (signature.vec()?.length ?? 0) > 0;
  return isSignedSmartAccountAuthPayload(signature);
}
