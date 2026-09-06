module.exports = async function signArtistMac(options) {
  const identity = process.env.ARTIST_OS_SIGN_IDENTITY || process.env.CSC_NAME
  if (!/^[A-F0-9]{40}$/i.test(identity || '')) {
    throw new Error('ARTIST_OS_SIGN_IDENTITY or CSC_NAME must be the exact 40-character certificate fingerprint')
  }
  const { sign } = await import('@electron/osx-sign')
  await sign({ ...options, identity })
}
