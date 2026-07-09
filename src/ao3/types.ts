import { AO3_ORIGIN } from '../config/constants';

export type PageKind = 'work' | 'tag' | 'author' | 'search' | 'unknown';

export interface ListedWorkAuthor {
  key: string;
  displayName: string;
}

export interface ListedWork {
  workId: string;
  title: string;
  tags: string[];
  authors: ListedWorkAuthor[];
  wordCount: number | null;
}

export interface WorkPageData {
  kind: 'work';
  workId: string;
  title: string;
  tags: string[];
  authors: Array<{ key: string; displayName: string }>;
  wordCount: number | null;
  url: string;
}

export interface TagPageData {
  kind: 'tag';
  tagName: string;
  workCount: number | null;
  works: ListedWork[];
  url: string;
}

export interface AuthorPageData {
  kind: 'author';
  authorKey: string;
  displayName: string;
  workCount: number | null;
  works: ListedWork[];
  url: string;
}

export interface SearchPageData {
  kind: 'search';
  works: ListedWork[];
  url: string;
}

export type PageData = WorkPageData | TagPageData | AuthorPageData | SearchPageData;

export function workUrl(workId: string): string {
  return `${AO3_ORIGIN}/works/${workId}`;
}

/**
 * AO3 tag path encoding (Tag#to_param): replace URL-hostile characters with
 * starred tokens before percent-encoding. e.g. "M/M" → "M*s*M".
 * @see https://github.com/otwcode/otwarchive/blob/master/app/models/tag.rb
 */
export function encodeAo3TagParam(tagName: string): string {
  const parameterized = tagName
    .replaceAll('/', '*s*')
    .replaceAll('&', '*a*')
    .replaceAll('.', '*d*')
    .replaceAll('?', '*q*')
    .replaceAll('#', '*h*');
  return encodeURIComponent(parameterized);
}

/** Inverse of encodeAo3TagParam (Tag.from_param + URI decode). */
export function decodeAo3TagParam(param: string): string {
  const decoded = decodeURIComponent(param.replace(/\+/g, ' '));
  return decoded.replace(/\*[sadqh]\*/g, (token) => {
    switch (token) {
      case '*s*':
        return '/';
      case '*a*':
        return '&';
      case '*d*':
        return '.';
      case '*q*':
        return '?';
      case '*h*':
        return '#';
      default:
        return token;
    }
  });
}

export function tagWorksUrl(tagName: string): string {
  return `${AO3_ORIGIN}/tags/${encodeAo3TagParam(tagName)}/works`;
}

export function authorWorksUrl(authorKey: string): string {
  return `${AO3_ORIGIN}/users/${authorKey}/works`;
}

export function parseWorkIdFromUrl(url: string): string | null {
  const match = url.match(/\/works\/(\d+)/);
  return match ? match[1] : null;
}

export function parseTagNameFromUrl(url: string): string | null {
  const match = url.match(/\/tags\/([^/]+)\/works/);
  return match ? decodeAo3TagParam(match[1]) : null;
}

export function parseAuthorKeyFromHref(href: string): string | null {
  const match = href.match(/\/users\/([^?#]+)/);
  if (!match) return null;
  return match[1].replace(/\/$/, '');
}

const RESERVED_USER_PATHS = new Set([
  'login',
  'sign_up',
  'account',
  'dashboard',
  'password',
  'support',
  'besignedup',
]);

export function parseAuthorKeyFromUrl(url: string): string | null {
  const match = url.match(/\/users\/([^/?#]+(?:\/pseuds\/[^/?#]+)?)(?:\/works)?(?:[/?#]|$)/);
  if (!match) return null;
  const key = match[1].replace(/\/$/, '');
  if (RESERVED_USER_PATHS.has(key.split('/')[0])) return null;
  return key;
}

export function isSearchResultsUrl(url: string): boolean {
  try {
    return new URL(url).pathname === '/works/search';
  } catch {
    return /\/works\/search(?:[/?#]|$)/.test(url);
  }
}

export function detectPageKind(url: string): PageKind {
  if (parseWorkIdFromUrl(url)) return 'work';
  if (isSearchResultsUrl(url)) return 'search';
  if (parseTagNameFromUrl(url)) return 'tag';
  if (parseAuthorKeyFromUrl(url)) return 'author';
  return 'unknown';
}
