import { detectPageKind } from '@/src/ao3/types';
import { parseAuthorPage, parseSearchPage, parseTagPage, parseWorkPage } from '@/src/ao3';
import { sendMessage } from '@/src/messaging/protocol';
import type { ExtensionMessage } from '@/src/messaging/types';

const buttonStyle =
  'padding:8px 12px;border-radius:6px;border:1px solid #900;background:#fff;cursor:pointer;font:13px sans-serif;';

function isWorkSuppressed(state: ExtensionMessage | undefined, workId: string): boolean {
  return (
    state?.type === 'StateUpdate' &&
    state.suppressedWorks.some((work) => work.workId === workId)
  );
}

function setSuppressButton(button: HTMLButtonElement, suppressed: boolean): void {
  button.textContent = suppressed ? 'Show in results' : 'Hide from results';
  button.disabled = false;
}

export default defineContentScript({
  matches: ['*://archiveofourown.org/*'],
  runAt: 'document_idle',
  main() {
    const url = location.href;
    const kind = detectPageKind(url);
    if (kind === 'unknown') return;

    const payload =
      kind === 'work'
        ? parseWorkPage(document, url)
        : kind === 'tag'
          ? parseTagPage(document, url)
          : kind === 'author'
            ? parseAuthorPage(document, url)
            : kind === 'search'
              ? parseSearchPage(document, url)
              : null;

    if (!payload) return;

    void sendMessage({ type: 'PageDataIngested', payload });

    if (kind !== 'work' && kind !== 'tag' && kind !== 'author') return;

    const container = document.createElement('div');
    container.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;';

    if (kind === 'work') {
      const workId = payload.kind === 'work' ? payload.workId : null;

      const addSeed = document.createElement('button');
      addSeed.textContent = 'Add as seed';
      addSeed.type = 'button';
      addSeed.style.cssText = buttonStyle;
      addSeed.addEventListener('click', () => {
        void sendMessage({ type: 'AddSeedFromTab' });
        addSeed.textContent = 'Added!';
        addSeed.disabled = true;
      });

      const addNegative = document.createElement('button');
      addNegative.textContent = 'Avoid this work';
      addNegative.type = 'button';
      addNegative.style.cssText = buttonStyle + 'border-color:#555;color:#333;';
      addNegative.addEventListener('click', () => {
        void sendMessage({ type: 'AddNegativeWorkFromTab' });
        addNegative.textContent = 'Avoided!';
        addNegative.disabled = true;
      });

      const suppress = document.createElement('button');
      suppress.type = 'button';
      suppress.style.cssText = buttonStyle + 'border-color:#555;color:#333;';
      suppress.textContent = 'Hide from results';
      suppress.addEventListener('click', () => {
        suppress.disabled = true;
        void sendMessage({ type: 'ToggleSuppressWorkFromTab' }).then((response) => {
          if (workId) setSuppressButton(suppress, isWorkSuppressed(response, workId));
          else suppress.disabled = false;
        });
      });

      if (workId) {
        void sendMessage({ type: 'GetState' }).then((response) => {
          setSuppressButton(suppress, isWorkSuppressed(response, workId));
        });
      }

      container.append(addSeed, addNegative, suppress);
    } else if (kind === 'tag') {
      const addSeed = document.createElement('button');
      addSeed.textContent = 'Add as seed';
      addSeed.type = 'button';
      addSeed.style.cssText = buttonStyle;
      addSeed.addEventListener('click', () => {
        void sendMessage({ type: 'AddSeedFromTab' });
        addSeed.textContent = 'Added!';
        addSeed.disabled = true;
      });

      const avoidTag = document.createElement('button');
      avoidTag.textContent = 'Avoid this tag';
      avoidTag.type = 'button';
      avoidTag.style.cssText = buttonStyle + 'border-color:#555;color:#333;';
      avoidTag.addEventListener('click', () => {
        void sendMessage({ type: 'AddNegativeTagFromTab' });
        avoidTag.textContent = 'Avoided!';
        avoidTag.disabled = true;
      });
      container.append(addSeed, avoidTag);
    } else if (kind === 'author') {
      const addSeed = document.createElement('button');
      addSeed.textContent = 'Add as seed';
      addSeed.type = 'button';
      addSeed.style.cssText = buttonStyle;
      addSeed.addEventListener('click', () => {
        void sendMessage({ type: 'AddSeedFromTab' });
        addSeed.textContent = 'Added!';
        addSeed.disabled = true;
      });

      const avoidAuthor = document.createElement('button');
      avoidAuthor.textContent = 'Avoid this author';
      avoidAuthor.type = 'button';
      avoidAuthor.style.cssText = buttonStyle + 'border-color:#555;color:#333;';
      avoidAuthor.addEventListener('click', () => {
        void sendMessage({ type: 'AddNegativeWorkFromTab' });
        avoidAuthor.textContent = 'Avoided!';
        avoidAuthor.disabled = true;
      });
      container.append(addSeed, avoidAuthor);
    }

    document.body.appendChild(container);
  },
});
