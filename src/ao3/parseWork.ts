import type { WorkMetadata } from '../graph/types';
import { selectors, wordCountPattern } from './selectors';
import type { ListedWorkAuthor, WorkPageData } from './types';
import { parseAuthorKeyFromHref, parseWorkIdFromUrl, workUrl } from './types';
import { completionStatusFromChapters, emptyWorkMetadata } from './workMeta';

function queryTagTexts(root: ParentNode, selector: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const el of root.querySelectorAll(selector)) {
    const text = el.textContent?.trim() ?? '';
    if (!text || seen.has(text)) continue;
    seen.add(text);
    tags.push(text);
  }
  return tags;
}

export function parseAuthorsFromElement(
  root: ParentNode,
  authorLinkSelector: string,
): ListedWorkAuthor[] {
  const authors: ListedWorkAuthor[] = [];
  const seen = new Set<string>();

  for (const link of root.querySelectorAll(authorLinkSelector)) {
    const href = link.getAttribute('href');
    if (!href) continue;
    const key = parseAuthorKeyFromHref(href);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    authors.push({
      key,
      displayName: link.textContent?.trim() || key,
    });
  }

  return authors;
}

export function parseAuthorsFromDocument(doc: Document): ListedWorkAuthor[] {
  return parseAuthorsFromElement(doc, selectors.workAuthors);
}

export function parseWorkPageMetadata(doc: Document): WorkMetadata {
  const meta = emptyWorkMetadata();
  meta.rating = queryTagTexts(doc, selectors.workRating)[0] ?? null;
  meta.archiveWarnings = queryTagTexts(doc, selectors.workWarning);
  meta.categories = queryTagTexts(doc, selectors.workCategory);
  meta.fandoms = queryTagTexts(doc, selectors.workFandom);

  const languageEl = doc.querySelector(selectors.workLanguage);
  meta.language = languageEl?.textContent?.trim() || null;

  const chaptersEl = doc.querySelector(selectors.workChapters);
  meta.completionStatus = completionStatusFromChapters(chaptersEl?.textContent);

  return meta;
}

export function parseWorkPage(doc: Document, url: string): WorkPageData | null {
  const workId = parseWorkIdFromUrl(url);
  if (!workId) return null;

  const titleEl = doc.querySelector(selectors.workTitle);
  const title = titleEl?.textContent?.trim().replace(/\s+/g, ' ') || `Work ${workId}`;

  const tagEls = doc.querySelectorAll(selectors.workTags);
  const tags = [...tagEls]
    .map((el) => el.textContent?.trim() ?? '')
    .filter(Boolean);

  const wordsEl = doc.querySelector(selectors.workWords);
  const wordsMatch = wordsEl?.textContent?.match(wordCountPattern);
  const wordCount = wordsMatch ? Number.parseInt(wordsMatch[1].replace(/,/g, ''), 10) : null;

  return {
    kind: 'work',
    workId,
    title,
    tags,
    authors: parseAuthorsFromDocument(doc),
    wordCount: Number.isFinite(wordCount) ? wordCount : null,
    url: workUrl(workId),
    meta: parseWorkPageMetadata(doc),
  };
}

export function parseWorkPageFromHtml(html: string, url: string): WorkPageData | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parseWorkPage(doc, url);
}
