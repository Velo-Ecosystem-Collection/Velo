import { defineConfig } from "vite";

export default defineConfig({
  build: {
    assetsInlineLimit: 200_000,
    emptyOutDir: true,
    lib: {
      entry: {
        config: "src/config.ts",
        browser: "src/browser.ts",
        logos: "src/wallet-logos.ts",
        element: "src/element.ts",
        react: "src/react.tsx",
      },
      fileName: (_format, entryName) => `${entryName}.js`,
      formats: ["es"],
    },
    outDir: "dist",
    rollupOptions: {
      external: ["react", "react/jsx-runtime"],
    },
    sourcemap: true,
  },
});
