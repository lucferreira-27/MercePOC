import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Merce | Estúdio de móveis',
  description: 'Crie e ajuste sua estante por conversa.',
};
/**
 * Tema antes da primeira pintura: a página lia a preferência só depois de
 * hidratar e abria clara por um instante antes de ficar escura.
 */
const THEME_BOOT = `try{var t=localStorage.getItem('merce-theme');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){}`;
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
