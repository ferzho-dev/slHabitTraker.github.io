import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset paths work for both the root site and GitHub Pages project paths.
  base: "/slHabitTraker.github.io/",
  plugins: [react()],
});
