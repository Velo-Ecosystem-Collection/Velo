import { GasTelemetryFixture } from "@/features/projects/gas-telemetry-fixture";
import { notFound } from "next/navigation";

export default function GasTelemetryFixturePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <GasTelemetryFixture />;
}
