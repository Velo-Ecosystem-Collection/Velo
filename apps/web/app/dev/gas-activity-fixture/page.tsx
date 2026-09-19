import { GasActivityFixture } from "@/features/projects/gas-activity-fixture";
import { notFound } from "next/navigation";

export default function GasActivityFixturePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <GasActivityFixture />;
}
