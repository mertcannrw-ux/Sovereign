import { repairJson, stringifyJson } from './json-repair';
import { seedPackageJson } from './stack-seeds';
import stackLock from './stack-lock.json';

export interface PackageJsonShape {
  name?: string;
  private?: boolean;
  version?: string;
  type?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export interface CompletePackageJsonResult {
  json: string;
  repaired: boolean;
  completed: boolean;
  seeded: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.trim()) out[key] = entry;
  }
  return out;
}

function pinDependency(
  pkg: PackageJsonShape,
  name: string,
  version: string,
  preferred: 'dependencies' | 'devDependencies',
): boolean {
  const inDeps = pkg.dependencies?.[name];
  const inDev = pkg.devDependencies?.[name];
  if (inDeps === version || inDev === version) return false;
  if (inDeps !== undefined) {
    pkg.dependencies = { ...pkg.dependencies, [name]: version };
    return inDeps !== version;
  }
  if (inDev !== undefined) {
    pkg.devDependencies = { ...pkg.devDependencies, [name]: version };
    return inDev !== version;
  }
  if (preferred === 'dependencies') {
    pkg.dependencies = { ...pkg.dependencies, [name]: version };
  } else {
    pkg.devDependencies = { ...pkg.devDependencies, [name]: version };
  }
  return true;
}

function seedCompleted(options?: { extraDependencies?: Record<string, string> }): PackageJsonShape {
  const pkg = JSON.parse(seedPackageJson()) as PackageJsonShape;
  if (options?.extraDependencies) applyExtras(pkg, options.extraDependencies);
  return pkg;
}

export function completePackageJson(
  raw: string | undefined,
  options?: { extraDependencies?: Record<string, string> },
): CompletePackageJsonResult {
  if (raw === undefined || raw.trim() === '') {
    return {
      json: stringifyJson(seedCompleted(options)),
      repaired: false,
      completed: true,
      seeded: true,
    };
  }

  const parsed = repairJson(raw);
  if (parsed === null || !isPlainObject(parsed)) {
    return { json: raw, repaired: false, completed: false, seeded: false };
  }

  const pkg: PackageJsonShape = { ...parsed };
  let completed = false;

  if (typeof pkg.name !== 'string' || !pkg.name.trim()) {
    pkg.name = 'generated-app';
    completed = true;
  }
  if (pkg.private !== true) {
    pkg.private = true;
    completed = true;
  }
  if (typeof pkg.version !== 'string' || !pkg.version.trim()) {
    pkg.version = '0.0.0';
    completed = true;
  }
  if (pkg.type !== 'module') {
    pkg.type = 'module';
    completed = true;
  }

  pkg.scripts = asStringRecord(pkg.scripts);
  pkg.dependencies = asStringRecord(pkg.dependencies);
  pkg.devDependencies = asStringRecord(pkg.devDependencies);

  for (const [name, script] of Object.entries(stackLock.scripts)) {
    if (pkg.scripts[name] !== script) {
      pkg.scripts[name] = script;
      completed = true;
    }
  }
  for (const [name, version] of Object.entries(stackLock.dependencies)) {
    if (pinDependency(pkg, name, version, 'dependencies')) completed = true;
  }
  for (const [name, version] of Object.entries(stackLock.devDependencies)) {
    if (pinDependency(pkg, name, version, 'devDependencies')) completed = true;
  }
  if (options?.extraDependencies) {
    for (const [name, version] of Object.entries(options.extraDependencies)) {
      if (pinDependency(pkg, name, version, 'dependencies')) completed = true;
    }
  }

  const originallyValid = (() => {
    try {
      JSON.parse(raw);
      return true;
    } catch {
      return false;
    }
  })();

  return {
    json: stringifyJson(pkg),
    repaired: !originallyValid,
    completed,
    seeded: false,
  };
}

function applyExtras(pkg: PackageJsonShape, extras: Record<string, string>): PackageJsonShape {
  for (const [name, version] of Object.entries(extras)) {
    pinDependency(pkg, name, version, 'dependencies');
  }
  return pkg;
}
