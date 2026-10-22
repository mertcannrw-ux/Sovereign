// @vitest-environment node
import { createHmac } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getR2ConfigStatus, signAssetUrl, verifyAssetToken } from './r2';
import { uploadProjectAsset, deleteProjectAsset, detectImageMediaType } from './project-assets';

vi.mock('@/env', () => ({
  env: {
    R2_ACCOUNT_ID: 'test-account',
    R2_ACCESS_KEY_ID: 'test-key',
    R2_SECRET_ACCESS_KEY: 'test-secret',
    R2_BUCKET_NAME: 'test-bucket',
    R2_PUBLIC_URL: 'https://pub.r2.dev',
    NEXTAUTH_SECRET: 'a'.repeat(32),
    NEXTAUTH_URL: 'http://localhost:3000',
  },
}));

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

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
const mockDbAggregate = vi.fn();
const mockDbExecuteRaw = vi.fn();

vi.mock('@/lib/db', () => ({
  getDb: () => {
    const projectAsset = {
      create: mockDbCreate,
      findFirst: mockDbFindFirst,
      delete: mockDbDelete,
      aggregate: mockDbAggregate,
    };
    return {
      projectAsset,
      $executeRaw: mockDbExecuteRaw,
      // Mirror Prisma's interactive transaction: run the callback with the same
      // mocked client so the locked re-check is exercised.
      $transaction: (
        run: (tx: {
          projectAsset: typeof projectAsset;
          $executeRaw: typeof mockDbExecuteRaw;
        }) => unknown,
      ) => run({ projectAsset, $executeRaw: mockDbExecuteRaw }),
    };
  },
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
    mockDbAggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: { byteSize: 0 } });
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

    const asset = await uploadProjectAsset({
      projectId: 'proj-1',
      bytes: PNG_BYTES,
      mediaType: 'image/png',
      prompt: 'A test icon',
    });

    expect(mockS3Send).toHaveBeenCalledTimes(1);
    expect(mockDbCreate).toHaveBeenCalledTimes(1);
    expect(asset.id).toBe('asset-1');
  });

  it('rejects a concurrent upload that slipped past the pre-upload check', async () => {
    // Fast-path aggregate is under the cap; the locked re-check sees the burst
    // that committed in between.
    mockDbAggregate
      .mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { byteSize: 0 } })
      .mockResolvedValueOnce({
        _count: { _all: 1 },
        _sum: { byteSize: 2 * 1024 * 1024 * 1024 },
      });

    await expect(
      uploadProjectAsset({
        projectId: 'proj-1',
        bytes: PNG_BYTES,
        mediaType: 'image/png',
      }),
    ).rejects.toThrow('asset storage limit');

    expect(mockDbExecuteRaw).toHaveBeenCalledTimes(1);
    expect(mockDbCreate).not.toHaveBeenCalled();
    // The object uploaded before the transaction was compensated.
    expect(mockS3Send).toHaveBeenCalledTimes(2);
  });

  it('deletes R2 object if DB insert fails', async () => {
    mockDbCreate.mockRejectedValue(new Error('DB Constraint Violation'));

    await expect(
      uploadProjectAsset({
        projectId: 'proj-1',
        bytes: PNG_BYTES,
        mediaType: 'image/png',
      }),
    ).rejects.toThrow('DB Constraint Violation');

    // S3 put was called, and then S3 delete was called for compensation
    expect(mockS3Send).toHaveBeenCalledTimes(2);
  });

  it('rejects payloads that are not a recognized image', async () => {
    await expect(
      uploadProjectAsset({
        projectId: 'proj-1',
        bytes: new Uint8Array([1, 2, 3, 4]),
        mediaType: 'image/png',
      }),
    ).rejects.toThrow('Unrecognized image format');
    expect(mockS3Send).not.toHaveBeenCalled();
  });
});

describe('detectImageMediaType', () => {
  it('detects PNG magic bytes', () => {
    expect(detectImageMediaType(PNG_BYTES)).toBe('image/png');
  });
});

describe('signAssetUrl', () => {
  it('round-trips a valid HMAC token', () => {
    const query = signAssetUrl('projects/p1/assets/a.png');
    const params = new URLSearchParams(query);
    expect(
      verifyAssetToken('projects/p1/assets/a.png', params.get('expires')!, params.get('sig')!),
    ).toBe(true);
    expect(
      verifyAssetToken('projects/p1/assets/other.png', params.get('expires')!, params.get('sig')!),
    ).toBe(false);
  });

  it('accepts URLs signed with the pre-deploy payload', () => {
    // Tokens minted before the domain-separated payload are already persisted
    // in generated app source and deployed bundles; rejecting them 401s every
    // image that was signed before the deploy.
    const expires = Math.floor(Date.now() / 1000) + 3_600;
    const legacySig = createHmac('sha256', 'a'.repeat(32))
      .update(`projects/p1/assets/a.png:${expires}`)
      .digest('hex');

    expect(verifyAssetToken('projects/p1/assets/a.png', String(expires), legacySig)).toBe(true);
    expect(verifyAssetToken('projects/p1/assets/other.png', String(expires), legacySig)).toBe(
      false,
    );
    expect(verifyAssetToken('projects/p1/assets/a.png', String(expires + 1), legacySig)).toBe(
      false,
    );
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
