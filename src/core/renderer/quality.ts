export type QualityTier = 'low' | 'medium' | 'high';

export interface QualityProfile {
  /** Chunk radius rendered around the player. */
  renderDistance: number;
  /** Shadow map resolution; 0 disables shadows. */
  shadowMapSize: number;
  /** Upper bound for devicePixelRatio. */
  maxPixelRatio: number;
  antialias: boolean;
  /** Multiplier for particle counts (debris, weather). */
  particleScale: number;
}

export const QUALITY_PROFILES: Record<QualityTier, QualityProfile> = {
  low: {
    renderDistance: 4,
    shadowMapSize: 0,
    maxPixelRatio: 1,
    antialias: false,
    particleScale: 0.5,
  },
  medium: {
    renderDistance: 6,
    shadowMapSize: 1024,
    maxPixelRatio: 1.5,
    antialias: true,
    particleScale: 0.8,
  },
  high: {
    renderDistance: 8,
    shadowMapSize: 2048,
    maxPixelRatio: 2,
    antialias: true,
    particleScale: 1,
  },
};

export interface DeviceInfo {
  gpu: string;
  cores: number;
  memoryGb: number | null;
}

/** Reads the GPU renderer string from a throwaway context, then releases it. */
export function probeDevice(): DeviceInfo {
  let gpu = 'unknown';
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const raw = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      if (typeof raw === 'string') gpu = raw;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    // Probing is best effort; fall through with "unknown".
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    gpu,
    cores: navigator.hardwareConcurrency || 4,
    memoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
  };
}

/** Maps device characteristics to a starting quality tier. */
export function classifyDevice(info: DeviceInfo): QualityTier {
  const gpu = info.gpu.toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) return 'low';
  if (info.memoryGb !== null && info.memoryGb <= 2) return 'low';
  if (info.cores <= 2) return 'low';

  const discrete = /nvidia|geforce|rtx|gtx|radeon rx|radeon pro|arc\(tm\)|intel\(r\) arc/.test(gpu);
  const appleSilicon = /apple m\d|apple gpu/.test(gpu);
  if ((discrete || appleSilicon) && info.cores >= 6) return 'high';

  const weakIntegrated = /hd graphics [2-5]\d{3}|mali-[t4]|adreno \(tm\) [3-5]|powervr/.test(gpu);
  if (weakIntegrated) return 'low';
  return 'medium';
}
