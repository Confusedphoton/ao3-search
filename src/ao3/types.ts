import { AO3_ORIGIN } from '../config/constants';

export type PageKind = 'work' | 'tag' | 'author' | 'unknown';

export interface ListedWorkAuthor {
  key: string;
  displayName: string;
}

export interface ListedWork {
  workId: string;
  title: string;
  tags: string[];
  authors: ListedWorkAuthor[];
}

export interface WorkPageData {
  kind: 'work';
  workId: string;
  title: string;
  tags: string[];
  authors: Array<{ key: string; displayName: string }>;
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

export type PageData = WorkPageData | TagPageData | AuthorPageData;

export function workUrl(workId: string): string {
  return `${AO3_ORIGIN}/works/${workId}`;
}

export function tagWorksUrl(tagName: string): string {
  return `${AO3_ORIGIN}/tags/${encodeURIComponent(tagName)}/works`;
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
  return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : null;
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

export function detectPageKind(url: string): PageKind {
  if (parseWorkIdFromUrl(url)) return 'work';
  if (parseTagNameFromUrl(url)) return 'tag';
  if (parseAuthorKeyFromUrl(url)) return 'author';
  return 'unknown';
}
