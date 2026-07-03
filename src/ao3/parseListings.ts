import { parseAuthorsFromElement } from './parseWork';
import { selectors } from './selectors';
import type { ListedWork } from './types';

function parseWorkIdFromHref(href: string): string | null {
  const match = href.match(/\/works\/(\d+)/);
  return match ? match[1] : null;
}

function parseWordCountFromBlurb(blurb: Element): number | null {
  const wordsEl = blurb.querySelector(selectors.workBlurbWords);
  const text = wordsEl?.textContent?.trim();
  if (!text) return null;
  const match = text.match(/^([\d,]+)/);
  if (!match) return null;
  const count = Number.parseInt(match[1].replace(/,/g, ''), 10);
  return Number.isFinite(count) ? count : null;
}

function parseTagsFromBlurb(blurb: Element): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const el of blurb.querySelectorAll(selectors.workBlurbTags)) {
    const text = el.textContent?.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    tags.push(text);
  }

  return tags;
}

export function parseWorkBlurb(blurb: Element): ListedWork | null {
  const titleLink = blurb.querySelector(selectors.workBlurbTitle);
  const href = titleLink?.getAttribute('href');
  if (!href) return null;

  const workId = parseWorkIdFromHref(href);
  if (!workId) return null;

  const title = titleLink.textContent?.trim() || `Work ${workId}`;

  return {
    workId,
    title,
    tags: parseTagsFromBlurb(blurb),
    authors: parseAuthorsFromElement(blurb, selectors.workBlurbAuthors),
    wordCount: parseWordCountFromBlurb(blurb),
  };
}

export function parseListedWorks(doc: Document): ListedWork[] {
  const works: ListedWork[] = [];
  const seen = new Set<string>();

  for (const blurb of doc.querySelectorAll(selectors.workBlurb)) {
    const parsed = parseWorkBlurb(blurb);
    if (!parsed || seen.has(parsed.workId)) continue;
    seen.add(parsed.workId);
    works.push(parsed);
  }

  return works;
}
