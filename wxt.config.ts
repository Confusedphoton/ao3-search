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
      "Discover new AO3 works through graph-based baysian search.",
    permissions: ["storage", "tabs", "scripting"],
    host_permissions: ["https://archiveofourown.org/*"],
    browser_specific_settings: {
      gecko: {
        // Firefox requires data_collection_permissions but we have none.
        data_collection_permissions: {},
        // Prevent graph resets and re-imports on every reload.
        id: "ao3graphsearch@confusedphoton",
      },
    },
  },
});
