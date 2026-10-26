import { findUsageInPayload, NormalizedUsage } from '../pricing/token-usage';

export class SseUsageSniffer {
  private readonly decoder = new TextDecoder();
  private lineBuffer = '';
  private dataLines: string[] = [];
  private latestUsage: NormalizedUsage | null = null;
  private latestId: string | null = null;

  push(chunk: Uint8Array) {
    this.lineBuffer += this.decoder.decode(chunk, { stream: true });
    this.consumeCompleteLines();
  }

  finish() {
    this.lineBuffer += this.decoder.decode();
    this.consumeCompleteLines();
    if (this.lineBuffer) this.consumeLine(this.lineBuffer.replace(/\r$/, ''));
    this.consumeEvent();
    return { usage: this.latestUsage, id: this.latestId };
  }

  private consumeCompleteLines() {
    const lines = this.lineBuffer.split('\n');
    this.lineBuffer = lines.pop() ?? '';
    for (const line of lines) this.consumeLine(line.replace(/\r$/, ''));
  }

  private consumeLine(line: string) {
    if (line === '') {
      this.consumeEvent();
      return;
    }
    if (line.startsWith('data:')) {
      this.dataLines.push(line.slice(5).trimStart());
    }
  }

  private consumeEvent() {
    if (this.dataLines.length === 0) return;
    const data = this.dataLines.join('\n');
    this.dataLines = [];
    if (data === '[DONE]') return;
    try {
      const payload: unknown = JSON.parse(data);
      const usage = findUsageInPayload(payload);
      if (usage) this.latestUsage = usage;
      if (payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>;
        const response = record.response && typeof record.response === 'object'
          ? record.response as Record<string, unknown>
          : undefined;
        const id = record.id ?? response?.id;
        if (typeof id === 'string') this.latestId = id;
      }
    } catch {
      // Partial or non-JSON SSE events are forwarded unchanged and ignored for accounting.
    }
  }
}
