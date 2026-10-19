import { describe, it, expect } from 'vitest';
import {
  ProjectStatus,
  RealmRole,
  RealmType,
  DeploymentStatus,
  JobStatus,
  SubscriptionStatus,
  FileOperation,
  AuthProvider,
  AIProvider,
  AI_PROVIDER_LABELS,
  CreateProjectInput,
  UpdateProjectInput,
  CreateApiKeyInput,
  SendChatInput,
} from './index';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('enum schemas', () => {
  it('ProjectStatus accepts the three statuses and rejects others', () => {
    expect(ProjectStatus.parse('DRAFT')).toBe('DRAFT');
    expect(ProjectStatus.parse('PUBLISHED')).toBe('PUBLISHED');
    expect(ProjectStatus.parse('ARCHIVED')).toBe('ARCHIVED');
    expect(() => ProjectStatus.parse('INVALID')).toThrow();
  });

  it('RealmRole accepts OWNER/ADMIN/MEMBER', () => {
    expect(RealmRole.parse('OWNER')).toBe('OWNER');
    expect(RealmRole.parse('ADMIN')).toBe('ADMIN');
    expect(RealmRole.parse('MEMBER')).toBe('MEMBER');
    expect(() => RealmRole.parse('USER')).toThrow();
  });

  it('RealmType accepts PERSONAL/SHARED', () => {
    expect(RealmType.parse('PERSONAL')).toBe('PERSONAL');
    expect(RealmType.parse('SHARED')).toBe('SHARED');
    expect(() => RealmType.parse('TEAM')).toThrow();
  });

  it('DeploymentStatus accepts the lifecycle states', () => {
    for (const value of ['QUEUED', 'BUILDING', 'DEPLOYING', 'LIVE', 'FAILED', 'CANCELED']) {
      expect(DeploymentStatus.parse(value)).toBe(value);
    }
    expect(() => DeploymentStatus.parse('PENDING')).toThrow();
  });

  it('JobStatus accepts the job states', () => {
    for (const value of ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED']) {
      expect(JobStatus.parse(value)).toBe(value);
    }
    expect(() => JobStatus.parse('PENDING')).toThrow();
  });

  it('SubscriptionStatus accepts the billing states', () => {
    for (const value of ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'INCOMPLETE']) {
      expect(SubscriptionStatus.parse(value)).toBe(value);
    }
    expect(() => SubscriptionStatus.parse('EXPIRED')).toThrow();
  });

  it('FileOperation accepts CREATE/UPDATE/DELETE', () => {
    for (const value of ['CREATE', 'UPDATE', 'DELETE']) {
      expect(FileOperation.parse(value)).toBe(value);
    }
    expect(() => FileOperation.parse('READ')).toThrow();
  });

  it('AuthProvider accepts the supported providers', () => {
    for (const value of ['email', 'google', 'github', 'saml']) {
      expect(AuthProvider.parse(value)).toBe(value);
    }
    expect(() => AuthProvider.parse('twitter')).toThrow();
  });

  it('AIProvider accepts the BYOK roster', () => {
    for (const value of ['openai', 'anthropic', 'google', 'mistral', 'groq', 'ollama', 'custom']) {
      expect(AIProvider.parse(value)).toBe(value);
    }
    expect(() => AIProvider.parse('cohere')).toThrow();
  });

  it('AI_PROVIDER_LABELS covers every provider', () => {
    for (const provider of AIProvider.options) {
      expect(AI_PROVIDER_LABELS[provider]).toBeTruthy();
    }
  });
});

describe('CreateProjectInput', () => {
  it('accepts a fully specified project', () => {
    const input = {
      name: 'My Project',
      description: 'A test project',
      modelProvider: 'openai',
      modelName: 'gpt-4',
      realmId: UUID,
    };
    expect(CreateProjectInput.parse(input)).toEqual(input);
  });

  it('rejects an empty name', () => {
    expect(() =>
      CreateProjectInput.parse({
        name: '',
        modelProvider: 'openai',
        modelName: 'gpt-4',
        realmId: UUID,
      }),
    ).toThrow();
  });

  it('rejects a non-uuid realmId', () => {
    expect(() =>
      CreateProjectInput.parse({
        name: 'X',
        modelProvider: 'openai',
        modelName: 'gpt-4',
        realmId: 'not-a-uuid',
      }),
    ).toThrow();
  });
});

describe('UpdateProjectInput', () => {
  it('accepts a partial update with only an id', () => {
    expect(UpdateProjectInput.parse({ id: UUID })).toEqual({ id: UUID });
  });

  it('rejects a missing id', () => {
    expect(() => UpdateProjectInput.parse({ name: 'New' })).toThrow();
  });

  it('rejects an invalid status', () => {
    expect(() => UpdateProjectInput.parse({ id: UUID, status: 'NOPE' })).toThrow();
  });
});

describe('CreateApiKeyInput', () => {
  it('accepts a provider and key', () => {
    expect(CreateApiKeyInput.parse({ provider: 'openai', key: 'sk-test123' })).toEqual({
      provider: 'openai',
      key: 'sk-test123',
    });
  });

  it('normalizes an empty baseUrl to undefined', () => {
    expect(CreateApiKeyInput.parse({ provider: 'custom', key: 'k', baseUrl: '' }).baseUrl).toBe(
      undefined,
    );
  });

  it('rejects an unknown provider', () => {
    expect(() => CreateApiKeyInput.parse({ provider: 'cohere', key: 'k' })).toThrow();
  });

  it('rejects an empty key', () => {
    expect(() => CreateApiKeyInput.parse({ provider: 'openai', key: '' })).toThrow();
  });
});

describe('SendChatInput', () => {
  it('accepts a valid chat message', () => {
    const input = {
      projectId: UUID,
      content: 'Hello, AI!',
      modelProvider: 'openai',
      modelName: 'gpt-4',
    };
    expect(SendChatInput.parse(input)).toEqual(input);
  });

  it('rejects empty content', () => {
    expect(() =>
      SendChatInput.parse({
        projectId: UUID,
        content: '',
        modelProvider: 'openai',
        modelName: 'gpt-4',
      }),
    ).toThrow();
  });
});
