import { checkoutIntegrationPrompt } from "./checkout-integration-prompt";
import { IntegrationPromptCard } from "./integration-prompt-card";

export function CheckoutIntegrationPromptCard() {
  return (
    <IntegrationPromptCard
      title="Integrate Checkout Sessions with your coding agent"
      description="Copy this prompt and paste it into your coding agent to adapt a complete, safe Checkout Sessions workflow to your existing project."
      prompt={checkoutIntegrationPrompt}
      accessibleLabel="Checkout Sessions integration prompt"
    />
  );
}
