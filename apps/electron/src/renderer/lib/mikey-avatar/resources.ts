import type { BufferGeometry, Material, Object3D, Skeleton, Texture } from 'three'

/** Dispose unique resources, including decoded GLTF ImageBitmaps. */
export function disposeAvatarModel(root: Object3D) {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  const skeletons = new Set<Skeleton>()
  root.traverse(object => {
    const mesh = object as Object3D & { geometry?: BufferGeometry; material?: Material | Material[]; skeleton?: Skeleton }
    if (mesh.geometry) geometries.add(mesh.geometry)
    if (mesh.skeleton) skeletons.add(mesh.skeleton)
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material) continue
      materials.add(material)
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value)
    }
  })
  const images = new Set<{ close?: () => void }>()
  for (const texture of textures) {
    const source = texture.source?.data
    for (const image of Array.isArray(source) ? source : [source]) if (image) images.add(image)
  }
  for (const resource of [...geometries, ...materials, ...textures, ...skeletons]) resource.dispose()
  for (const image of images) image.close?.()
}
