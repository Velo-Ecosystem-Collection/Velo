import { IntegrationPromptCard } from "./integration-prompt-card";
import { paymentIntentsIntegrationPrompt } from "./payment-intents-integration-prompt";

export function PaymentIntentsIntegrationPromptCard() {
  return (
    <IntegrationPromptCard
      title="Integrate Payment Intents with your coding agent"
      description="Copy this prompt and paste it into your coding agent to adapt a complete, safe Payment Intents workflow to your existing project."
      prompt={paymentIntentsIntegrationPrompt}
      accessibleLabel="Payment Intents integration prompt"
    />
  );
}
