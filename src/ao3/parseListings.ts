import { parseAuthorsFromElement } from './parseWork';
import { selectors } from './selectors';
import type { ListedWork } from './types';
import {
  completionStatusFromChapters,
  completionStatusFromLabel,
  emptyWorkMetadata,
  splitCommaSeparatedMeta,
} from './workMeta';
import type { WorkMetadata } from '../graph/types';

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

function requiredTagLabel(blurb: Element, selector: string): string | null {
  const el = blurb.querySelector(selector);
  if (!el) return null;
  const title = el.getAttribute('title')?.trim();
  if (title) return title;
  const text = el.querySelector('.text')?.textContent?.trim() || el.textContent?.trim();
  return text || null;
}

function parseBlurbMetadata(blurb: Element): WorkMetadata {
  const meta = emptyWorkMetadata();

  meta.rating = requiredTagLabel(blurb, selectors.workBlurbRequiredRating);

  const warningTags: string[] = [];
  const seenWarnings = new Set<string>();
  for (const el of blurb.querySelectorAll(selectors.workBlurbWarnings)) {
    const text = el.textContent?.trim();
    if (!text || seenWarnings.has(text)) continue;
    seenWarnings.add(text);
    warningTags.push(text);
  }
  if (warningTags.length > 0) {
    meta.archiveWarnings = warningTags;
  } else {
    meta.archiveWarnings = splitCommaSeparatedMeta(
      requiredTagLabel(blurb, selectors.workBlurbRequiredWarnings),
    );
  }

  meta.categories = splitCommaSeparatedMeta(
    requiredTagLabel(blurb, selectors.workBlurbRequiredCategory),
  );

  const fandoms: string[] = [];
  const seenFandoms = new Set<string>();
  for (const el of blurb.querySelectorAll(selectors.workBlurbFandoms)) {
    const text = el.textContent?.trim();
    if (!text || seenFandoms.has(text)) continue;
    seenFandoms.add(text);
    fandoms.push(text);
  }
  meta.fandoms = fandoms;

  const languageEl = blurb.querySelector(selectors.workBlurbLanguage);
  meta.language = languageEl?.textContent?.trim() || null;

  const wipLabel = requiredTagLabel(blurb, selectors.workBlurbRequiredWip);
  meta.completionStatus =
    completionStatusFromLabel(wipLabel) ??
    completionStatusFromChapters(blurb.querySelector(selectors.workBlurbChapters)?.textContent);

  return meta;
}

export function parseWorkBlurb(blurb: Element): ListedWork | null {
  const titleLink = blurb.querySelector(selectors.workBlurbTitle);
  if (!titleLink) return null;
  const href = titleLink.getAttribute('href');
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
    meta: parseBlurbMetadata(blurb),
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
