export const selectors = {
  workMeta: 'dl.work.meta.group',
  workTags: 'dl.work.meta.group dd.tags a.tag',
  workAuthors: 'dl.work.meta.group dd.users a[href*="/users/"]',
  workTitle: 'h2.title.heading, h2.title, h1.title, #workskin h2.title.heading',
  tagHeading: 'h2.heading',
  authorHeading: 'h2.heading',
  workListing: 'ol.work.index.group li.work.blurb h4.heading a, ol.work.index.group li.work.blurb h3.title a',
} as const;

export const tagCountPattern = /([\d,]+)\s+Works?/i;
