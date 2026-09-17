/** Do not expose raw transport/provider messages: they may contain credentials. */
export function composioErrorMessage(error: unknown, action: string): string {
  const message = error instanceof Error ? error.message : ''
  if (/No handler for: composio:|Unknown (?:RPC )?channel.*composio|composio\w* is not a function/i.test(message)) {
    return 'Restart Artist OS to load the new Composio connection support, then try again. Your API key has not been checked yet.'
  }
  if (message.includes('Composio API key is invalid or revoked')) {
    return 'Composio rejected the API key as invalid or revoked. Check the project key in its dashboard.'
  }
  if (message.includes('Could not reach Composio')) return 'Could not reach Composio. Check your connection and try again.'
  if (message.includes('Composio denied access')) return 'Composio denied access. Check the project key permissions in its dashboard.'
  if (message.includes('usage or rate limit')) return 'Composio or Gmail reached a usage limit. Check Composio Usage before retrying.'
  if (message.includes('requires secrets.update')) return 'Composio is shared across this host. Owner access is required in every registered workspace.'
  return action === 'save'
    ? 'Artist OS could not complete Composio verification. This does not necessarily mean the key is wrong. Try Refresh; if you just updated Artist OS, restart it first.'
    : 'Artist OS could not reach its Composio connection service. If you just updated the app, restart Artist OS and try again.'
}
