import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deleteArtistVaultAsset, importArtistVaultAssets, linkArtistVaultFolder, scanArtistVault, loadArtistVaultManifest, readArtistVaultAssetDataUrl } from './index'

for (const filename of ['song.wav', 'photo.png', 'clip.mp4', 'notes.txt']) {
  test(`deletes only the Vault copy of ${filename} and does not resurrect on scan`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'vault-delete-'))
    try {
      const original = join(root, filename)
      writeFileSync(original, 'test')
      const asset = importArtistVaultAssets(root, 'test', [original]).imported[0]!
      const result = deleteArtistVaultAsset(root, 'test', asset.id)
      expect(existsSync(original)).toBe(true)
      expect(existsSync(join(root, asset.relativePath!))).toBe(false)
      expect(result.assets[0]!.status).toBe('archived')
      expect(result.assets[0]!.usableByAgents).toBe(false)
      expect(scanArtistVault(root, 'test').added).toHaveLength(0)
      expect(deleteArtistVaultAsset(root, 'test', asset.id).assets).toHaveLength(1)
      await expect(readArtistVaultAssetDataUrl(root, 'test', asset.id)).rejects.toThrow('deleted')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}

test('removing a linked asset preserves its file and a repeated folder link does not resurrect it', () => {
  const root = mkdtempSync(join(tmpdir(), 'vault-linked-delete-'))
  try {
    const folder = join(root, 'originals'); mkdirSync(folder)
    const original = join(folder, 'photo.png'); writeFileSync(original, 'test')
    const asset = linkArtistVaultFolder(root, 'test', folder).linked[0]!
    deleteArtistVaultAsset(root, 'test', asset.id)
    expect(existsSync(original)).toBe(true)
    linkArtistVaultFolder(root, 'test', folder)
    expect(loadArtistVaultManifest(root, 'test').assets.filter(x => x.status !== 'archived')).toHaveLength(0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('refuses to delete through a symlink outside the Vault', () => {
  const root = mkdtempSync(join(tmpdir(), 'vault-symlink-delete-'))
  try {
    const original = join(root, 'photo.png'); writeFileSync(original, 'test')
    const asset = importArtistVaultAssets(root, 'test', [original]).imported[0]!
    const copied = join(root, asset.relativePath!); rmSync(copied); symlinkSync(original, copied)
    expect(() => deleteArtistVaultAsset(root, 'test', asset.id)).toThrow('regular file inside')
    expect(existsSync(original)).toBe(true)
    expect(loadArtistVaultManifest(root, 'test').assets[0]!.status).not.toBe('archived')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
