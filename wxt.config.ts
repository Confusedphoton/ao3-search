import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/auto-icons"],
  autoIcons: {
    baseIconPath: "assets/icon.svg",
  },
  manifestVersion: 3,
  zip: {
    // Firefox zips project sources by default; exclude local AO3 dataset files.
    excludeSources: ["**/*.csv", "20210226-stats/**"],
  },
  manifest: {
    name: "AO3 Graph Search",
    description:
      "Discover new AO3 works through graph-based Bayesian search.",
    permissions: ["storage", "tabs", "scripting"],
    host_permissions: ["https://archiveofourown.org/*"],
    browser_specific_settings: {
      gecko: {
        // AMO requires declaring data collection; this extension stores data locally only.
        data_collection_permissions: {
          required: ["none"],
        },
        // Prevent graph resets and re-imports on every reload.
        id: "ao3graphsearch@confusedphoton",
      },
    },
  },
});
