export const selectors = {
  workMeta: 'dl.work.meta.group',
  workTags: 'dl.work.meta.group dd.tags a.tag',
  workAuthors: 'dl.work.meta.group dd.users a[href*="/users/"]',
  workTitle: 'h2.title.heading, h2.title, h1.title, #workskin h2.title.heading',
  tagHeading: 'h2.heading',
  authorHeading: 'h2.heading',
  workBlurb: 'ol.work.index.group li.work.blurb',
  workBlurbTitle: 'h4.heading a[href*="/works/"], h3.title a[href*="/works/"]',
  workBlurbAuthors: 'h4.heading a[href*="/users/"]',
  workBlurbTags: 'h5.fandoms.heading a.tag, ul.tags.commas a.tag',
} as const;

export const tagCountPattern = /([\d,]+)\s+Works?/i;
