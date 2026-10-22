export interface GenerateBody {
  projectId?: string;
  message?: string;
  modelProvider?: string;
  modelName?: string;
  files?: { path?: string; content?: string }[];
  reasoningEffort?: string;
  /** Recent preview console errors the client captured, sent with the turn. */
  runtimeErrors?: string[];
  editTarget?: {
    sourceFile?: string;
    tagName?: string;
    selector?: string;
    outerHTML?: string;
  };
  directionResponse?: {
    action: 'select' | 'skip' | 'regenerate';
    setId: string;
    directionId?: string;
  };
}

export interface AgentUser {
  id: string;
  email?: string | null;
  name?: string | null;
}

export interface AgentExecutionParams {
  user: AgentUser;
  body: GenerateBody;
  runtimeEnabled: boolean;
  signal?: AbortSignal;
  /**
   * Wall-clock budget after which the run settles and releases its lease.
   * Must stay below the hosting function's own timeout: a platform kill skips
   * `finally`, so the project would stay locked until the lease goes stale.
   */
  softDeadlineMs?: number;
}

export type AgentStreamResult =
  | {
      ok: true;
      generator: AsyncGenerator<Uint8Array>;
    }
  | {
      ok: false;
      status: number;
      body: {
        error: string;
        retryAfterMs?: number;
      };
    };

export type GeneratePayloadValidation =
  { ok: true; data: GenerateBody } | { ok: false; error: string };
