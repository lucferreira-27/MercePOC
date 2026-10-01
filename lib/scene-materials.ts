import * as THREE from 'three';
import { materials } from './furniture';

/** Brilho da peça selecionada: soma à cor do acabamento, não a substitui. */
export const SELECTION_GLOW = '#3f9a5c';
/** Cores do diff na cena: entrou (verde), mudou (âmbar), saiu (vermelho). */
export const DIFF_GLOW = { added: '#2fa25c', changed: '#e0972b', removed: '#e0564f' } as const;

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

/**
 * Textura própria de pedra, palhinha, tela e vidro canelado, já na cor do
 * material (a cor da peça fica branca para não tingir de novo). Palhinha e
 * tela têm furos: o material usa `alphaTest` e as duas faces. Mesma escala
 * de `panelUV` (1400 × 700 mm por repetição).
 */
export function surfaceTexture(materialId: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const m = materials.find((v) => v.id === materialId);
  if (!m || !['stone', 'cane', 'glass', 'metal'].includes(m.finish)) return null;
  if (m.finish === 'glass' && m.id !== 'glass-ribbed') return null;
  const key = `surface:${m.id}`;
  if (cache.has(key)) return cache.get(key)!;
  const texture =
    m.finish === 'stone' ? stoneTexture(m.color, hash(m.id)) : m.finish === 'cane' ? caneTexture(m.color) : m.finish === 'metal' ? meshTexture(m.color) : ribbedTexture(m.color);
  cache.set(key, texture);
  return texture;
}

function rgb(hex: string) {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * Ruído de valor que repete sem emenda: uma grade de `cells` × `cells` com
 * valores sorteados, interpolada suave e dando a volta nas bordas.
 */
function tileNoise(random: () => number, cells: number) {
  const grid = Array.from({ length: cells * cells }, () => random());
  const at = (x: number, y: number) => grid[(((y % cells) + cells) % cells) * cells + (((x % cells) + cells) % cells)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (u: number, v: number) => {
    const x = u * cells,
      y = v * cells;
    const x0 = Math.floor(x),
      y0 = Math.floor(y);
    const fx = smooth(x - x0),
      fy = smooth(y - y0);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return a + (b - a) * fy;
  };
}

/**
 * Pedra: nuvens suaves e veios finos e irregulares, em diagonal, desenhados
 * com turbulência (o seno de uma direção deformado por ruído fractal). Tudo
 * repete sem emenda, então um tampo de 3 m não mostra costura.
 */
function stoneTexture(hex: string, seed: number) {
  const W = 1024,
    H = 512;
  const random = rng(seed);
  const [r, g, b] = rgb(hex);
  const dark = r + g + b < 200;
  // Veio claro na pedra escura (Nero), escuro na clara (mármore, travertino).
  const vein = dark ? [228, 226, 220] : [Math.max(0, r - 85), Math.max(0, g - 85), Math.max(0, b - 78)];
  const octaves = [4, 8, 16, 32].map((cells) => tileNoise(random, cells));
  const fbm = (u: number, v: number) => octaves.reduce((a, n, i) => a + n(u, v) / 2 ** i, 0) / 1.875;
  const cloud = tileNoise(random, 3);
  const TAU = Math.PI * 2;
  const texture = canvasTexture(W, H, (data) => {
    for (let y = 0; y < H; y++) {
      const v = y / H;
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const turb = fbm(u, v);
        // Dois sistemas de veio: um principal, longo, e um fino que cruza.
        const main = Math.pow(1 - Math.abs(Math.sin(TAU * (2 * u + v) + 7 * turb)), 26);
        const fine = Math.pow(1 - Math.abs(Math.sin(TAU * (3 * u - 2 * v) + 9 * turb + 1.3)), 70) * 0.35;
        const veinK = Math.min(1, main * 0.75 + fine);
        const k = 0.94 + 0.1 * cloud(u, v) + (turb - 0.5) * 0.06;
        const i = (y * W + x) * 4;
        data[i] = Math.min(255, r * k) * (1 - veinK) + vein[0] * veinK;
        data[i + 1] = Math.min(255, g * k) * (1 - veinK) + vein[1] * veinK;
        data[i + 2] = Math.min(255, b * k) * (1 - veinK) + vein[2] * veinK;
        data[i + 3] = 255;
      }
    }
  });
  if (texture) texture.userData = { roughness: 0.22, white: true };
  return texture;
}

/** Palhinha indiana: trama em diagonal e na grade, com os furos octogonais. */
function caneTexture(hex: string) {
  const W = 1024,
    H = 512;
  const [r, g, b] = rgb(hex);
  // Célula de ~25 mm: 56 × 28 na repetição de 1400 × 700 mm.
  const cx = W / 56,
    cy = H / 28;
  const texture = canvasTexture(W, H, (data) => {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const u = (x % cx) / cx - 0.5,
          v = (y % cy) / cy - 0.5;
        const straight = Math.min(Math.abs(u), Math.abs(v)) < 0.08;
        const diagonal = Math.min(Math.abs(u - v), Math.abs(u + v)) < 0.09;
        const strand = straight || diagonal;
        const hole = !strand && Math.hypot(u, v) > 0.18;
        const i = (y * W + x) * 4;
        const shade = straight ? 1 : 0.88;
        data[i] = r * shade;
        data[i + 1] = g * shade;
        data[i + 2] = b * shade;
        data[i + 3] = hole ? 0 : 255;
      }
  });
  if (texture) texture.userData = { roughness: 0.75, white: true, alphaTest: 0.5, doubleSide: true };
  return texture;
}

/**
 * Tela metálica: metal expandido, a malha em losango das portas
 * industriais (losango de ~25 × 12 mm), o resto vazado.
 */
function meshTexture(hex: string) {
  const W = 1024,
    H = 512;
  const [r, g, b] = rgb(hex);
  // 56 × 56 losangos na repetição de 1400 × 700 mm.
  const cx = W / 56,
    cy = H / 56;
  const texture = canvasTexture(W, H, (data) => {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        // Distância à borda do losango da célula: perto da borda é fio.
        const u = Math.abs(((x % cx) / cx) * 2 - 1),
          v = Math.abs(((y % cy) / cy) * 2 - 1);
        const wire = Math.abs(u + v - 1) < 0.16;
        const i = (y * W + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = wire ? 255 : 0;
      }
  });
  if (texture) texture.userData = { roughness: 0.4, white: true, alphaTest: 0.5, doubleSide: true };
  return texture;
}

/**
 * Vidro canelado: caneluras de ~10 mm, claras e escuras. Variam no sentido
 * de través da textura (v): no vidro de porta, mais alto que largo, o veio
 * (u) corre na altura e as caneluras ficam em pé.
 */
function ribbedTexture(hex: string) {
  const W = 64,
    H = 1024;
  const [r, g, b] = rgb(hex);
  const period = H / 70;
  const texture = canvasTexture(W, H, (data) => {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const k = 0.82 + 0.18 * Math.cos(((y % period) / period) * Math.PI * 2);
        const i = (y * W + x) * 4;
        data[i] = r * k;
        data[i + 1] = g * k;
        data[i + 2] = b * k;
        data[i + 3] = 255;
      }
  });
  if (texture) texture.userData = { roughness: 0.1, white: true };
  return texture;
}

/**
 * Chapa perfurada (painel de ferramentas): a cor do painel com furos de
 * 6 mm a cada 25 mm, escuros como a sombra do furo. Mesma escala do resto.
 */
export function perforatedTexture(hex: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const key = `perforated:${hex}`;
  if (cache.has(key)) return cache.get(key)!;
  const W = 1024,
    H = 512;
  const [r, g, b] = rgb(hex);
  const cx = W / 56,
    cy = H / 28;
  const texture = canvasTexture(W, H, (data) => {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const u = (x % cx) / cx - 0.5,
          v = (y % cy) / cy - 0.5;
        const hole = Math.hypot(u, v) < 0.13;
        const k = hole ? 0.18 : 1;
        const i = (y * W + x) * 4;
        data[i] = r * k;
        data[i + 1] = g * k;
        data[i + 2] = b * k;
        data[i + 3] = 255;
      }
  });
  if (texture) texture.userData = { roughness: 0.7, white: true };
  cache.set(key, texture);
  return texture;
}
