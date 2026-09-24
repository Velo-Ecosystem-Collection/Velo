import { CopyButton } from "@repo/ui/components/common/copy-button";

import { gasIntegrationPrompt } from "./gas-integration-prompt";

/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The scrollable text preview needs keyboard scroll access. */
export function GasIntegrationPromptCard() {
  return (
    <section
      aria-labelledby="gas-integration-prompt-title"
      className="rounded-xl border border-primary/25 bg-primary/5 p-4 sm:p-5"
    >
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 id="gas-integration-prompt-title" className="text-base font-semibold text-foreground">
            Integrate Gas Station with your coding agent
          </h2>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Copy this prompt and paste it into your coding agent to adapt the complete Gas Station
            workflow to your existing project.
          </p>
        </div>
        <CopyButton
          value={gasIntegrationPrompt}
          label="Gas Station integration prompt"
          visibleText="Copy prompt"
          size="sm"
          className="w-full shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground sm:w-auto"
        />
      </div>

      <details className="mt-4 rounded-lg border border-border bg-background/80">
        <summary className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          Preview prompt
        </summary>
        <pre
          tabIndex={0}
          className="max-h-[32rem] overflow-auto border-t border-border p-4 font-mono text-xs leading-relaxed [overflow-wrap:anywhere] break-words whitespace-pre-wrap text-foreground select-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {gasIntegrationPrompt}
        </pre>
      </details>
      <p className="mt-2 text-xs text-zinc-700 dark:text-zinc-300">
        If clipboard access fails, open the preview and copy the prompt text manually.
      </p>
    </section>
  );
}
