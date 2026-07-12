export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    jitter?: boolean;
    onRetry?: (attempt: number, err: Error) => void;
  } = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 500,
    maxDelayMs = 10_000,
    jitter = true,
    onRetry,
  } = options;

  let lastErr: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxRetries) break;
      let delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      if (jitter) delay *= 0.75 + Math.random() * 0.5;
      if (onRetry) onRetry(attempt + 1, lastErr);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastErr;
}
