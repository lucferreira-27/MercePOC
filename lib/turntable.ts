import * as THREE from 'three';
import type { Part } from './furniture';
import type { FurnitureMotion } from './furniture-motion';
import type { Fitting } from './fittings';
import { PRINT_VIEW, shotScene } from './print-render';

/**
 * Arquivos da conversa que só o navegador faz, porque dependem de WebGL: a
 * foto do móvel (PNG) e o vídeo dele girando (WebM). Os dois saem da mesma
 * cena da foto do PDF, fora da tela, e não dependem da câmera da pessoa.
 */
export const VIDEO = { width: 1280, height: 720, seconds: 6, fps: 30 } as const;
const BACKGROUND = '#f4f1ec';

/** A foto do PDF em fundo claro (a transparente some no tema escuro). */
export function furniturePhoto(parts: readonly Part[], params: Parameters<FurnitureMotion['update']>[1], fittings: readonly Fitting[] = []) {
  const shot = shotScene(parts, params, { width: 1600, height: 1000 }, fittings);
  if (!shot) return null;
  try {
    shot.renderer.setClearColor(BACKGROUND, 1);
    shot.renderer.render(shot.scene, shot.camera);
    return new Promise<{ blob: Blob; width: number; height: number } | null>((done) =>
      shot.renderer.domElement.toBlob((blob) => {
        done(blob ? { blob, width: 1600, height: 1000 } : null);
        shot.dispose();
      }, 'image/png'),
    );
  } catch {
    shot.dispose();
    return null;
  }
}

/** Formato de vídeo que este navegador grava: WebM (VP9 ou VP8) ou MP4. */
function videoType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

/**
 * O móvel dando uma volta inteira em `VIDEO.seconds`, gravado do canvas.
 * A gravação é em tempo real (MediaRecorder): leva os segundos do vídeo.
 */
export async function recordTurntable(
  parts: readonly Part[],
  params: Parameters<FurnitureMotion['update']>[1],
  fittings: readonly Fitting[] = [],
): Promise<{ blob: Blob; durationMs: number; width: number; height: number }> {
  const type = videoType();
  if (!type) throw new Error('Este navegador não grava vídeo.');
  const shot = shotScene(parts, params, VIDEO, fittings);
  if (!shot) throw new Error('Sem WebGL para desenhar o móvel.');
  const canvas = shot.renderer.domElement;
  // Fora da tela, mas no documento: alguns navegadores só capturam assim.
  canvas.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:720px;pointer-events:none';
  document.body.appendChild(canvas);
  try {
    shot.renderer.setClearColor(BACKGROUND, 1);
    const { camera, center } = shot;
    const radius = Math.hypot(camera.position.x - center.x, camera.position.z - center.z) * 1.12;
    const height = camera.position.y - center.y;
    const stream = canvas.captureStream(VIDEO.fps);
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 5_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((done) => (recorder.onstop = () => done()));
    const total = VIDEO.seconds * 1000;
    const start0 = THREE.MathUtils.degToRad(PRINT_VIEW.azimuth);
    const draw = (t: number) => {
      const a = start0 + (t / total) * Math.PI * 2;
      camera.position.set(center.x + Math.sin(a) * radius, center.y + height, center.z + Math.cos(a) * radius);
      camera.lookAt(center);
      shot.renderer.render(shot.scene, camera);
    };
    draw(0);
    recorder.start(250);
    const began = performance.now();
    // Relógio de tempo real, não de quadros: com a aba em segundo plano o
    // navegador espaça os quadros, mas a volta termina no tempo certo.
    await new Promise<void>((done) => {
      const tick = () => {
        const t = performance.now() - began;
        draw(Math.min(t, total));
        if (t >= total) done();
        else setTimeout(tick, 1000 / VIDEO.fps);
      };
      tick();
    });
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(chunks, { type: type.split(';')[0] });
    if (!blob.size) throw new Error('A gravação saiu vazia.');
    return { blob, durationMs: total, width: VIDEO.width, height: VIDEO.height };
  } finally {
    canvas.remove();
    shot.dispose();
  }
}
