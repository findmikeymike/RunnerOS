import { expect, test } from 'bun:test'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three'
import { disposeAvatarModel } from './resources'

test('shared model resources and decoded image close only once', () => {
  const root = new Group()
  const geometry = new BoxGeometry()
  const material = new MeshStandardMaterial()
  const texture = new Texture()
  let imagesClosed = 0
  texture.source.data = { close() { imagesClosed++ } }
  material.map = texture; material.roughnessMap = texture
  root.add(new Mesh(geometry, material), new Mesh(geometry, material))
  const counts = { geometry: 0, material: 0, texture: 0 }
  geometry.addEventListener('dispose', () => counts.geometry++)
  material.addEventListener('dispose', () => counts.material++)
  texture.addEventListener('dispose', () => counts.texture++)
  disposeAvatarModel(root)
  expect(counts).toEqual({ geometry: 1, material: 1, texture: 1 })
  expect(imagesClosed).toBe(1)
})
