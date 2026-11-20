export interface Disposable {
  dispose(): void;
}

/**
 * Owns a set of disposable GPU resources (geometries, materials, textures,
 * render targets) so a subsystem can release everything it created in one call.
 */
export class ResourceTracker {
  private readonly resources = new Set<Disposable>();

  track<T extends Disposable>(resource: T): T {
    this.resources.add(resource);
    return resource;
  }

  release(resource: Disposable): void {
    if (this.resources.delete(resource)) resource.dispose();
  }

  get size(): number {
    return this.resources.size;
  }

  dispose(): void {
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
  }
}
