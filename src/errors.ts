export class InvalidUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidUrlError';
  }
}

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

export class NavigationFailedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NavigationFailedError';
  }
}

export interface ToolErrorResult {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
}

export function toToolError(err: unknown): ToolErrorResult {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}
