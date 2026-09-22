import { CredentialManager, StoredCredentials } from './CredentialManager.js';

/**
 * Shared credential resolution for API plugins. Consolidates the per-plugin
 * pattern of "flag/constructor value, else stored credential under one of a
 * few historical field names, else a source-specific error".
 *
 * This is the CredentialManager (stored-secret) path; OAuth sources that need
 * refresh go through TokenHelper.getValidToken instead.
 */

export interface CredentialFieldSpec {
  /** StoredCredentials fields tried in order until one has a value. */
  from: Array<keyof StoredCredentials | string>;
  /** Optional fields resolve to undefined instead of failing the lookup. */
  optional?: boolean;
}

export interface ResolveCredentialsOptions {
  /**
   * Already-resolved values (CLI flags, constructor args). A non-empty
   * override wins without consulting the store.
   */
  overrides?: Record<string, string | undefined>;
  /**
   * Full replacement for the missing-credential error, so a plugin keeps its
   * exact user-facing message (auth command, credential-creation URL, …).
   */
  errorMessage?: string;
}

/** Pure resolution core, separated for testing. */
export function pickCredentialFields<F extends string>(
  provider: string,
  stored: object | null,
  fields: Record<F, CredentialFieldSpec>,
  options: ResolveCredentialsOptions = {}
): Record<F, string | undefined> {
  const resolved = {} as Record<F, string | undefined>;
  const missing: F[] = [];
  const storedFields = (stored ?? {}) as Record<string, unknown>;

  for (const name of Object.keys(fields) as F[]) {
    const spec = fields[name];
    const override = options.overrides?.[name];
    let value = override || undefined;
    if (value === undefined && stored) {
      for (const alias of spec.from) {
        const candidate = storedFields[alias as string];
        if (typeof candidate === 'string' && candidate !== '') {
          value = candidate;
          break;
        }
      }
    }
    resolved[name] = value;
    if (value === undefined && !spec.optional) missing.push(name);
  }

  if (missing.length > 0) {
    throw new Error(
      options.errorMessage ??
        `${provider} credentials are missing ${missing.join(', ')}. Authenticate with: chronicle auth ${provider}`
    );
  }

  return resolved;
}

/**
 * Resolve a source's credentials: overrides first, then the stored
 * credentials under each field's alias chain. Throws when a required field
 * is missing everywhere.
 */
export async function resolveCredentials<F extends string>(
  provider: string,
  fields: Record<F, CredentialFieldSpec>,
  options: ResolveCredentialsOptions = {}
): Promise<Record<F, string | undefined>> {
  let stored: StoredCredentials | null = null;
  try {
    stored = await CredentialManager.getCredentials(provider);
  } catch {
    // No stored credentials — overrides may still satisfy the spec.
  }
  return pickCredentialFields(provider, stored, fields, options);
}
