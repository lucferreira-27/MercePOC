import type { Metadata, Viewport } from 'next';
import './globals.css';
import './app-shell.css';
export const metadata: Metadata = {
  title: 'Merce | Estúdio de móveis',
  description: 'Crie e ajuste sua estante por conversa.',
};
/**
 * Celular e tablet: a página ocupa a tela até as bordas (as áreas seguras são
 * tratadas no CSS) e o teclado encolhe o conteúdo em vez de cobri-lo.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};
/**
 * Tema antes da primeira pintura: a página lia a preferência só depois de
 * hidratar e abria clara por um instante antes de ficar escura.
 */
const THEME_BOOT = `try{var t=localStorage.getItem('merce-theme');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){}`;
/**
 * Casca do app antes da primeira pintura: no celular e no tablet o esqueleto
 * já sai com a navegação do app, sem piscar o estúdio de desktop. A consulta
 * é a mesma de APP_SHELL_QUERY em lib/shell.ts.
 */
const SHELL_BOOT = `try{if(matchMedia('(max-width: 959px), (max-height: 499px), (pointer: coarse) and (hover: none) and (max-width: 1400px)').matches)document.documentElement.dataset.shell='app'}catch(e){}`;
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT + SHELL_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
