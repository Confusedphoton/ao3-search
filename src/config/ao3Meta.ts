/** Canonical AO3 exhaustive metadata option lists for permeability filters. */

export const AO3_RATINGS = [
  'Not Rated',
  'General Audiences',
  'Teen And Up Audiences',
  'Mature',
  'Explicit',
] as const;

export const AO3_ARCHIVE_WARNINGS = [
  'Creator Chose Not To Use Archive Warnings',
  'Graphic Depictions Of Violence',
  'Major Character Death',
  'No Archive Warnings Apply',
  'Rape/Non-Con',
  'Underage',
] as const;

export const AO3_COMPLETION_STATUSES = ['Complete', 'Incomplete'] as const;

export const AO3_CATEGORIES = ['F/F', 'F/M', 'Gen', 'M/M', 'Multi', 'Other'] as const;

export type Ao3Rating = (typeof AO3_RATINGS)[number];
export type Ao3ArchiveWarning = (typeof AO3_ARCHIVE_WARNINGS)[number];
export type Ao3CompletionStatus = (typeof AO3_COMPLETION_STATUSES)[number];
export type Ao3Category = (typeof AO3_CATEGORIES)[number];

/** Ordered alphabetically by settings UI header labels. */
export const PERMEABILITY_CATEGORY_KEYS = [
  'archiveWarnings',
  'categories',
  'completionStatus',
  'fandoms',
  'language',
  'rating',
] as const;

export type PermeabilityCategoryKey = (typeof PERMEABILITY_CATEGORY_KEYS)[number];
