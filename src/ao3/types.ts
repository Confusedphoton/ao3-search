import { AO3_ORIGIN } from '../config/constants';

export type PageKind = 'work' | 'tag' | 'unknown';

export interface WorkPageData {
  kind: 'work';
  workId: string;
  title: string;
  tags: string[];
  url: string;
}

export interface TagPageData {
  kind: 'tag';
  tagName: string;
  workCount: number | null;
  workIds: string[];
  url: string;
}

export type PageData = WorkPageData | TagPageData;

export function workUrl(workId: string): string {
  return `${AO3_ORIGIN}/works/${workId}`;
}

export function tagWorksUrl(tagName: string): string {
  return `${AO3_ORIGIN}/tags/${encodeURIComponent(tagName)}/works`;
}

export function parseWorkIdFromUrl(url: string): string | null {
  const match = url.match(/\/works\/(\d+)/);
  return match ? match[1] : null;
}

export function parseTagNameFromUrl(url: string): string | null {
  const match = url.match(/\/tags\/([^/]+)\/works/);
  return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : null;
}

export function detectPageKind(url: string): PageKind {
  if (parseWorkIdFromUrl(url)) return 'work';
  if (parseTagNameFromUrl(url)) return 'tag';
  return 'unknown';
}
