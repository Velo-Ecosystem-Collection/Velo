"use client";

import { type ReactNode } from "react";

import { getGasFixtureStore, installGasFixtureBrowserApi } from "./store";

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const store = getGasFixtureStore();
  installGasFixtureBrowserApi(store);
  return children;
}
