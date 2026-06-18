import { detectPageKind } from '@/src/ao3/types';
import { parseTagPage, parseWorkPage } from '@/src/ao3';
import { sendMessage } from '@/src/messaging/protocol';

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
        : parseTagPage(document, url);

    if (!payload) return;

    void sendMessage({ type: 'PageDataIngested', payload });

    if (kind !== 'work') return;

    const button = document.createElement('button');
    button.textContent = 'Add as seed';
    button.type = 'button';
    button.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:9999;padding:8px 12px;border-radius:6px;border:1px solid #900;background:#fff;cursor:pointer;font:13px sans-serif;';
    button.addEventListener('click', () => {
      void sendMessage({ type: 'AddSeedFromTab' });
      button.textContent = 'Added!';
      button.disabled = true;
    });
    document.body.appendChild(button);
  },
});
