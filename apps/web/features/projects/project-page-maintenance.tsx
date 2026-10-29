import { Button } from "@repo/ui/components/ui/button";
import { ArrowLeftIcon, WrenchIcon } from "lucide-react";
import Link from "next/link";

type ProjectPageMaintenanceProps = {
  page: "payments" | "settlement";
};

const pageHeadings = {
  payments: "Payments are temporarily unavailable",
  settlement: "Settlement is temporarily unavailable",
} as const;

export function ProjectPageMaintenance({ page }: ProjectPageMaintenanceProps) {
  return (
    <section
      aria-labelledby="project-page-maintenance-title"
      aria-describedby="project-page-maintenance-description"
      className="mx-auto flex min-h-[50vh] w-full max-w-3xl items-center justify-center py-8 sm:py-12"
    >
      <div className="w-full rounded-xl border bg-card px-5 py-8 text-center shadow-sm sm:px-10 sm:py-12">
        <div
          aria-hidden="true"
          className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <WrenchIcon className="size-5" />
        </div>
        <h1
          id="project-page-maintenance-title"
          className="text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          {pageHeadings[page]}
        </h1>
        <p
          id="project-page-maintenance-description"
          className="mx-auto mt-3 max-w-prose text-sm leading-6 text-muted-foreground sm:text-base"
        >
          We’re upgrading the system. Please try again later.
        </p>
        <div className="mt-6">
          <Button asChild>
            <Link href="/dashboard">
              <ArrowLeftIcon aria-hidden="true" />
              Back to dashboard
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
