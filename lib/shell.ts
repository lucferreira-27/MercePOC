/**
 * Casca do app no celular e no tablet. Abaixo de 960 px de largura, com a
 * tela baixa (celular deitado) ou num tablet de toque, o estúdio deixa de ser
 * três painéis lado a lado e vira um app: um espaço de trabalho por vez, a
 * cena sempre à vista (em tela cheia ou numa janela flutuante).
 */
export const APP_SHELL_QUERY =
  '(max-width: 959px), (max-height: 499px), (pointer: coarse) and (hover: none) and (max-width: 1400px)';

/** Espaços de trabalho do app. */
export type Workspace = 'stage' | 'chat' | 'build' | 'numbers';
export const WORKSPACES: Workspace[] = ['stage', 'chat', 'build', 'numbers'];

type Tab = 'project' | 'room' | 'quote' | 'cut' | 'parts' | 'history';
/** Aba do inspetor → espaço que a mostra. Versões é o modo viagem no tempo, na cena. */
export function workspaceOfTab(tab: Tab): Workspace {
  return tab === 'project' || tab === 'room' ? 'build' : tab === 'history' ? 'stage' : 'numbers';
}
export const BUILD_TABS = ['project', 'room'] as const;
export const NUMBER_TABS = ['quote', 'cut', 'parts'] as const;

/**
 * Pilha de camadas para o botão voltar do sistema. Cada folha, modo ou "olhar
 * no móvel" que abre empilha uma entrada no histórico do navegador; voltar
 * fecha a camada de cima. Fechar pela interface consome a entrada sem
 * disparar o fechamento de novo.
 */
type Layer = { close: () => void; popped: boolean };
const layers: Layer[] = [];
let skipPops = 0;
let listening = false;
function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('popstate', () => {
    if (skipPops > 0) {
      skipPops--;
      return;
    }
    const top = layers.pop();
    if (top) {
      top.popped = true;
      top.close();
    }
  });
}
export function pushLayer(close: () => void) {
  listen();
  const layer: Layer = { close, popped: false };
  try {
    window.history.pushState({ merceLayer: layers.length + 1 }, '');
  } catch {
    // Sem histórico (iframe restrito): a camada só não responde ao voltar.
  }
  layers.push(layer);
  return () => {
    const i = layers.indexOf(layer);
    if (i >= 0) layers.splice(i, 1);
    if (!layer.popped) {
      skipPops++;
      try {
        window.history.back();
      } catch {
        skipPops--;
      }
    }
  };
}
