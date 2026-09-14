type AccountReference = { platform: string; profile: string }

export function socialAccountIdentityError(identity: {
  platform: string
  handle?: string
  accountUrl?: string
}): string | null {
  if (identity.platform === 'spotify') return null
  const handle = identity.handle?.trim().replace(/^@+/, '').trim()
  return handle || identity.accountUrl?.trim()
    ? null
    : 'Add the exact posting handle or account URL so Verify Login can check the right account.'
}

/** Match the backend slug contract; edits must retain the original browser identity. */
export function socialAccountReferenceError(
  reference: AccountReference,
  existing: readonly AccountReference[],
  editing: AccountReference | null,
): string | null {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(reference.profile)) {
    return 'Account reference must be 1–64 letters, numbers, dashes, or underscores, starting with a letter or number. No spaces.'
  }
  if (editing) {
    return editing.platform === reference.platform && editing.profile === reference.profile
      ? null
      : 'An existing account reference cannot be changed. Add a separate account instead.'
  }
  if (existing.some((item) => item.platform === reference.platform && item.profile.toLowerCase() === reference.profile.toLowerCase())) {
    return 'That account reference already exists on this platform, possibly in another account set. Choose a different reference or edit the existing account.'
  }
  return null
}
