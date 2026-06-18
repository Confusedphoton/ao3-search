import type { ExtensionMessage } from './types';
import { isExtensionMessage } from './types';

export async function sendMessage(
  message: ExtensionMessage,
): Promise<ExtensionMessage | undefined> {
  return browser.runtime.sendMessage(message) as Promise<ExtensionMessage | undefined>;
}

export function onMessage(
  handler: (
    message: ExtensionMessage,
    sender: Browser.runtime.MessageSender,
  ) => Promise<ExtensionMessage | undefined> | ExtensionMessage | undefined | void,
): void {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isExtensionMessage(message)) return;
    const result = handler(message, sender);
    if (result instanceof Promise) {
      result.then(sendResponse).catch((err: Error) => {
        console.error('[ao3-search] message handler error', err);
        sendResponse(undefined);
      });
      return true;
    }
    sendResponse(result);
    return false;
  });
}

export async function broadcast(message: ExtensionMessage): Promise<void> {
  await browser.runtime.sendMessage(message).catch(() => undefined);
}
