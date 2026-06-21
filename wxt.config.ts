import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  zip: {
    // Firefox zips project sources by default; exclude local AO3 dataset files.
    excludeSources: ['**/*.csv', '20210226-stats/**'],
  },
  manifest: {
    name: 'AO3 Semantic Search',
    description:
      'Discover AO3 works through graph-based Personalized PageRank, not exact tag matching.',
    permissions: ['storage', 'tabs', 'scripting'],
    host_permissions: ['https://archiveofourown.org/*'],
  },
});
