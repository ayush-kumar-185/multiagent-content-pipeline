export interface TruncatedOutputErrorOptions {
  status?: number;
  finishReason?: string | null;
  attemptedMaxTokens?: number;
  rawOutput?: string;
}

export class TruncatedOutputError extends Error {
  readonly status?: number;
  readonly finishReason?: string | null;
  readonly attemptedMaxTokens?: number;
  readonly rawOutput?: string;

  constructor(message: string, options?: TruncatedOutputErrorOptions) {
    super(message);
    this.name = 'TruncatedOutputError';
    this.status = options?.status;
    this.finishReason = options?.finishReason;
    this.attemptedMaxTokens = options?.attemptedMaxTokens;
    this.rawOutput = options?.rawOutput;
    Object.setPrototypeOf(this, TruncatedOutputError.prototype);
  }
}

