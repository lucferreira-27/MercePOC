import * as THREE from 'three';
import { materials } from './furniture';

/** Brilho da peça selecionada: soma à cor do acabamento, não a substitui. */
export const SELECTION_GLOW = '#3f9a5c';

/** Uma repetição da textura cobre isto em mm: veio ao longo, poros através. */
const GRAIN_ALONG = 1400;
const GRAIN_ACROSS = 700;

const cache = new Map<string, THREE.Texture | null>();

/**
 * Textura do acabamento, clara e quase neutra: o `color` do material tinge por
 * cima, então uma textura serve para qualquer cor do catálogo. Madeira ganha
 * veio contínuo e lisos ganham um granulado de laminado, quase invisível mas o
 * bastante para a luz não ficar de plástico.
 *
 * Sem `document` (testes em Node, servidor) não há textura: a cor sozinha
 * continua certa.
 */
export function finishTexture(hex: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const finish = materials.find((m) => m.color.toLowerCase() === hex.toLowerCase())?.finish ?? 'solid';
  const key = finish === 'wood' ? `wood:${hex}` : 'solid';
  if (cache.has(key)) return cache.get(key)!;
  const texture = finish === 'wood' ? woodTexture(hash(hex)) : laminateTexture();
  cache.set(key, texture);
  return texture;
}

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

/** Ruído determinístico: a mesma textura em toda recarga. */
function rng(seed: number) {
  let s = Math.floor(seed * 2 ** 31) || 1;
  return () => {
    s = (Math.imul(s, 48271) % 2147483647) + 0;
    return (s & 0x7fffffff) / 2147483647;
  };
}

function canvasTexture(width: number, height: number, paint: (data: Uint8ClampedArray) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const image = ctx.createImageData(width, height);
  paint(image.data);
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * Veio de madeira que repete sem emenda: todas as senoides fecham um número
 * inteiro de ciclos na largura e na altura do quadro.
 */
function woodTexture(seed: number) {
  const W = 1024,
    H = 512;
  const random = rng(seed);
  const phase = [random(), random(), random(), random()].map((v) => v * Math.PI * 2);
  const texture = canvasTexture(W, H, (data) => {
    const TAU = Math.PI * 2;
    for (let y = 0; y < H; y++) {
      const fy = y / H;
      for (let x = 0; x < W; x++) {
        const fx = x / W;
        // O veio corre em x, quase reto: laminado de madeira é fatiado, não
        // tem os anéis largos de uma tábua. A ondulação é leve e lenta.
        const warp =
          0.01 * Math.sin(TAU * (fx * 2) + phase[0] + TAU * fy) +
          0.004 * Math.sin(TAU * (fx * 5) + phase[1]) +
          0.008 * Math.sin(TAU * (fy * 3) + phase[2]);
        const t = fy + warp;
        const ring = 0.5 + 0.5 * Math.sin(TAU * 38 * t + phase[3]);
        const band = 0.5 + 0.5 * Math.sin(TAU * 6 * t + phase[1]);
        const fine = 0.5 + 0.5 * Math.sin(TAU * 170 * t + 2 * Math.sin(TAU * fx * 9));
        const dark = 0.07 + Math.pow(ring, 5) * 0.13 + band * 0.06 + fine * 0.05 + random() * 0.03;
        const lum = 255 * (1 - dark);
        const i = (y * W + x) * 4;
        // Um leve desvio quente nas linhas escuras, como a resina do veio.
        data[i] = lum;
        data[i + 1] = lum * (1 - dark * 0.08);
        data[i + 2] = lum * (1 - dark * 0.2);
        data[i + 3] = 255;
      }
    }
  });
  if (texture) texture.userData.roughness = 0.58;
  return texture;
}

function laminateTexture() {
  const W = 256,
    H = 256;
  const random = rng(0.37);
  const texture = canvasTexture(W, H, (data) => {
    for (let i = 0; i < W * H; i++) {
      const lum = 255 * (0.965 + random() * 0.035);
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = lum;
      data[i * 4 + 3] = 255;
    }
  });
  if (texture) texture.userData.roughness = 0.82;
  return texture;
}

/**
 * Coordenadas de textura em milímetros para uma caixa unitária escalada ao
 * tamanho da peça. Em cada face o veio segue o lado mais longo, que é o C da
 * peça (e o sentido do veio no plano de corte). O deslocamento por tamanho
 * evita que peças vizinhas mostrem o mesmo desenho lado a lado.
 */
export function panelUV(geometry: THREE.BufferGeometry, size: readonly [number, number, number]) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  if (!position || !normal || !uv) return;
  const offset = hash(size.join('x'));
  for (let i = 0; i < position.count; i++) {
    const n = [Math.abs(normal.getX(i)), Math.abs(normal.getY(i)), Math.abs(normal.getZ(i))];
    const axis = n[0] > 0.5 ? 0 : n[1] > 0.5 ? 1 : 2;
    const [a, b] = [0, 1, 2].filter((v) => v !== axis);
    const p = [position.getX(i), position.getY(i), position.getZ(i)];
    const pa = (p[a] + 0.5) * size[a];
    const pb = (p[b] + 0.5) * size[b];
    const [along, across] = size[a] >= size[b] ? [pa, pb] : [pb, pa];
    uv.setXY(i, along / GRAIN_ALONG + offset, across / GRAIN_ACROSS + offset * 0.5);
  }
  uv.needsUpdate = true;
}
