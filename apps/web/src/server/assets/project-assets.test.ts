// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getR2ConfigStatus } from './r2';
import { uploadProjectAsset, deleteProjectAsset } from './project-assets';

vi.mock('@/env', () => ({
  env: {
    R2_ACCOUNT_ID: 'test-account',
    R2_ACCESS_KEY_ID: 'test-key',
    R2_SECRET_ACCESS_KEY: 'test-secret',
    R2_BUCKET_NAME: 'test-bucket',
    R2_PUBLIC_URL: 'https://pub.r2.dev',
  },
}));

const mockS3Send = vi.fn().mockResolvedValue({});
vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: class {
      send = mockS3Send;
    },
    PutObjectCommand: vi.fn(),
    DeleteObjectCommand: vi.fn(),
  };
});

const mockDbCreate = vi.fn();
const mockDbFindFirst = vi.fn();
const mockDbDelete = vi.fn();

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    projectAsset: {
      create: mockDbCreate,
      findFirst: mockDbFindFirst,
      delete: mockDbDelete,
    },
  }),
}));

describe('getR2ConfigStatus', () => {
  it('reports configured when all 5 variables are present', () => {
    const status = getR2ConfigStatus();
    expect(status.isConfigured).toBe(true);
    expect(status.reason).toBeUndefined();
  });
});

describe('uploadProjectAsset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads to R2 first then saves DB record', async () => {
    const fakeAsset = {
      id: 'asset-1',
      projectId: 'proj-1',
      objectKey: 'projects/proj-1/assets/test.png',
      publicUrl: 'https://pub.r2.dev/projects/proj-1/assets/test.png',
      mediaType: 'image/png',
      byteSize: 4,
      source: 'generated',
    };
    mockDbCreate.mockResolvedValue(fakeAsset);

    const bytes = new Uint8Array([1, 2, 3, 4]);
    const asset = await uploadProjectAsset({
      projectId: 'proj-1',
      bytes,
      mediaType: 'image/png',
      prompt: 'A test icon',
    });

    expect(mockS3Send).toHaveBeenCalledTimes(1);
    expect(mockDbCreate).toHaveBeenCalledTimes(1);
    expect(asset.id).toBe('asset-1');
  });

  it('deletes R2 object if DB insert fails', async () => {
    mockDbCreate.mockRejectedValue(new Error('DB Constraint Violation'));

    const bytes = new Uint8Array([1, 2, 3, 4]);
    await expect(
      uploadProjectAsset({
        projectId: 'proj-1',
        bytes,
        mediaType: 'image/png',
      }),
    ).rejects.toThrow('DB Constraint Violation');

    // S3 put was called, and then S3 delete was called for compensation
    expect(mockS3Send).toHaveBeenCalledTimes(2);
  });
});

describe('deleteProjectAsset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes from R2 first then deletes DB record', async () => {
    mockDbFindFirst.mockResolvedValue({
      id: 'asset-1',
      projectId: 'proj-1',
      objectKey: 'projects/proj-1/assets/test.png',
    });
    mockDbDelete.mockResolvedValue({});

    await deleteProjectAsset('asset-1', 'proj-1');

    expect(mockS3Send).toHaveBeenCalledTimes(1);
    expect(mockDbDelete).toHaveBeenCalledTimes(1);
  });
});
