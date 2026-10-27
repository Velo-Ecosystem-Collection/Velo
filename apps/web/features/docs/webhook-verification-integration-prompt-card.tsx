import { IntegrationPromptCard } from "./integration-prompt-card";
import { webhookVerificationIntegrationPrompt } from "./webhook-verification-integration-prompt";

export function WebhookVerificationIntegrationPromptCard() {
  return (
    <IntegrationPromptCard
      title="Integrate Webhook Verification with your coding agent"
      description="Copy this prompt and paste it into your coding agent to adapt secure, durable webhook verification to your existing application."
      prompt={webhookVerificationIntegrationPrompt}
      accessibleLabel="Webhook Verification integration prompt"
    />
  );
}
