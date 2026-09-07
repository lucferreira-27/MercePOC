import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Merce | Estúdio de móveis',
  description: 'Crie e ajuste sua estante por conversa.',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
