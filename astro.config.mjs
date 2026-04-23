import { defineConfig } from "astro/config";

// If you rename the repo to `trident523.github.io`, change `base` to "/".
export default defineConfig({
  site: "https://trident523.github.io",
  base: "/miniature-enigma",
  trailingSlash: "ignore",
  build: {
    assets: "_assets",
  },
});
