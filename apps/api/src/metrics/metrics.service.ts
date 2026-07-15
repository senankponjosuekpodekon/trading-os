import { Injectable } from '@nestjs/common';

interface Histogram {
  values: number[];
  sum: number;
  count: number;
}

@Injectable()
export class MetricsService {
  private counters: Map<string, number> = new Map();
  private histograms: Map<string, Histogram> = new Map();

  inc(name: string, value = 1) {
    this.counters.set(name, (this.counters.get(name) || 0) + value);
  }

  observe(name: string, value: number) {
    const h = this.histograms.get(name) || { values: [], sum: 0, count: 0 };
    h.values.push(value);
    h.sum += value;
    h.count += 1;
    this.histograms.set(name, h);
  }

  time(name: string, fn: () => any) {
    const start = Date.now();
    try {
      return fn();
    } finally {
      this.observe(name, Date.now() - start);
    }
  }

  render(): string {
    const lines: string[] = ['# Trading OS API Metrics'];
    this.counters.forEach((value, name) => {
      lines.push(`${name} ${value}`);
    });
    this.histograms.forEach((h, name) => {
      lines.push(`${name}_count ${h.count}`);
      lines.push(`${name}_sum ${h.sum.toFixed(3)}`);
      lines.push(`${name}_avg ${h.count ? (h.sum / h.count).toFixed(3) : 0}`);
    });
    return lines.join('\n');
  }

  snapshot() {
    const snapshotHistograms: Record<string, any> = {};
    this.histograms.forEach((h, name) => {
      snapshotHistograms[name] = { count: h.count, sum: h.sum, avg: h.count ? h.sum / h.count : 0 };
    });
    return {
      counters: Object.fromEntries(this.counters),
      histograms: snapshotHistograms,
    };
  }
}
