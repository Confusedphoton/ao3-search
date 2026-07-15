import { AO3_ORIGIN } from '../config/constants';

/** Numeric range constraint serialized the way AO3 work search expects. */
export interface Ao3CountConstraint {
  min?: number | null;
  max?: number | null;
  exact?: number | null;
}

/**
 * Typed AO3 `/works/search` parameters.
 * Policies construct these explicitly; not mapped from permeability settings.
 */
export interface Ao3WorkSearchParams {
  page?: number;
  query?: string;
  title?: string;
  creators?: string;
  revisedAt?: string;
  complete?: boolean | null;
  crossover?: boolean | null;
  singleChapter?: boolean;
  wordCount?: Ao3CountConstraint | null;
  languageId?: string | null;
  fandomNames?: string[];
  ratingIds?: number | number[] | null;
  archiveWarningIds?: number[];
  categoryIds?: number[];
  characterNames?: string[];
  relationshipNames?: string[];
  freeformNames?: string[];
  hits?: Ao3CountConstraint | null;
  kudosCount?: Ao3CountConstraint | null;
  commentsCount?: Ao3CountConstraint | null;
  bookmarksCount?: Ao3CountConstraint | null;
  excludedTagNames?: string[];
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
}

function appendWorkSearch(
  params: URLSearchParams,
  key: string,
  value: string | number | boolean | null | undefined,
): void {
  if (value == null || value === '') return;
  params.append(`work_search[${key}]`, String(value));
}

function appendConstraint(
  params: URLSearchParams,
  key: string,
  constraint: Ao3CountConstraint | null | undefined,
): void {
  if (!constraint) return;
  if (constraint.exact != null) {
    appendWorkSearch(params, key, constraint.exact);
    return;
  }
  const min = constraint.min;
  const max = constraint.max;
  if (min != null && max != null) {
    appendWorkSearch(params, key, `${min}-${max}`);
  } else if (min != null) {
    appendWorkSearch(params, key, `>${min}`);
  } else if (max != null) {
    appendWorkSearch(params, key, `<${max}`);
  }
}

function appendList(params: URLSearchParams, key: string, values: string[] | number[] | undefined): void {
  if (!values?.length) return;
  for (const value of values) {
    params.append(`work_search[${key}][]`, String(value));
  }
}

export function worksSearchUrl(options: Ao3WorkSearchParams): string {
  const params = new URLSearchParams();
  const page = options.page ?? 1;
  if (page > 1) params.set('page', String(page));

  appendWorkSearch(params, 'query', options.query);
  appendWorkSearch(params, 'title', options.title);
  appendWorkSearch(params, 'creators', options.creators);
  appendWorkSearch(params, 'revised_at', options.revisedAt);

  if (options.complete === true) appendWorkSearch(params, 'complete', 'T');
  else if (options.complete === false) appendWorkSearch(params, 'complete', 'F');

  if (options.crossover === true) appendWorkSearch(params, 'crossover', 'T');
  else if (options.crossover === false) appendWorkSearch(params, 'crossover', 'F');

  if (options.singleChapter) appendWorkSearch(params, 'single_chapter', '1');

  appendConstraint(params, 'word_count', options.wordCount);
  appendWorkSearch(params, 'language_id', options.languageId);

  if (options.fandomNames?.length) {
    appendWorkSearch(params, 'fandom_names', options.fandomNames.join(','));
  }

  if (Array.isArray(options.ratingIds)) {
    appendList(params, 'rating_ids', options.ratingIds);
  } else {
    appendWorkSearch(params, 'rating_ids', options.ratingIds ?? undefined);
  }

  appendList(params, 'archive_warning_ids', options.archiveWarningIds);
  appendList(params, 'category_ids', options.categoryIds);

  if (options.characterNames?.length) {
    appendWorkSearch(params, 'character_names', options.characterNames.join(','));
  }
  if (options.relationshipNames?.length) {
    appendWorkSearch(params, 'relationship_names', options.relationshipNames.join(','));
  }
  if (options.freeformNames?.length) {
    appendWorkSearch(params, 'freeform_names', options.freeformNames.join(','));
  }

  appendConstraint(params, 'hits', options.hits);
  appendConstraint(params, 'kudos_count', options.kudosCount);
  appendConstraint(params, 'comments_count', options.commentsCount);
  appendConstraint(params, 'bookmarks_count', options.bookmarksCount);

  if (options.excludedTagNames?.length) {
    appendWorkSearch(params, 'excluded_tag_names', options.excludedTagNames.join(','));
  }

  appendWorkSearch(params, 'sort_column', options.sortColumn);
  appendWorkSearch(params, 'sort_direction', options.sortDirection);

  const query = params.toString();
  return query ? `${AO3_ORIGIN}/works/search?${query}` : `${AO3_ORIGIN}/works/search`;
}
