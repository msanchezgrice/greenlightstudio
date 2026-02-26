export type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  factor?: number;
};

export async function withRetry<T = unknown>(fn: () => Promise<T> | T, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const factor = options.factor ?? 2;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return (await Promise.resolve(fn())) as T;
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      const delay = baseDelayMs * factor ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Operation failed after retries");
}
