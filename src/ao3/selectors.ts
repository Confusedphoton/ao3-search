export const selectors = {
  workMeta: 'dl.work.meta.group',
  workTags: 'dl.work.meta.group dd.tags a.tag',
  workTitle: 'h2.title.heading',
  tagHeading: 'h2.heading',
  workListing: 'ol.work.index.group li.work.blurb h4.heading a',
} as const;

export const tagCountPattern = /([\d,]+)\s+Works?/i;
