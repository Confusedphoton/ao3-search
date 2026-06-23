export async function streamTextFileLines(
  file: File,
  onLine: (line: string) => Promise<void> | void,
): Promise<void> {
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += value;

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
      buffer = buffer.slice(newlineIndex + 1);
      await onLine(line);
      newlineIndex = buffer.indexOf('\n');
    }

    if (done) {
      if (buffer.length > 0) {
        await onLine(buffer.replace(/\r$/, ''));
      }
      break;
    }
  }
}
