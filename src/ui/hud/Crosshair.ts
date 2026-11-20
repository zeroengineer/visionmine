/** Centre-screen aiming reticle. */
export function createCrosshair(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'crosshair';
  el.setAttribute('aria-hidden', 'true');
  return el;
}
