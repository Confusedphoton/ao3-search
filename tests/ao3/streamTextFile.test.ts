import { describe, expect, it, vi } from 'vitest';
import { streamTextFileLines } from '../../src/ao3/streamTextFile';

describe('streamTextFileLines', () => {
  it('streams newline-delimited text without loading the full file', async () => {
    const chunks = ['line one\nline two\n', 'line three'];
    const file = {
      stream: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(new TextEncoder().encode(chunk));
            }
            controller.close();
          },
        }),
    } as File;

    const lines: string[] = [];
    await streamTextFileLines(file, (line) => {
      lines.push(line);
    });

    expect(lines).toEqual(['line one', 'line two', 'line three']);
  });

  it('strips carriage returns from Windows line endings', async () => {
    const file = {
      stream: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('alpha\r\nbeta\r'));
            controller.close();
          },
        }),
    } as File;

    const lines: string[] = [];
    await streamTextFileLines(file, (line) => {
      lines.push(line);
    });

    expect(lines).toEqual(['alpha', 'beta']);
  });
});
