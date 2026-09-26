'use client';
import {
  Boxes,
  Brain,
  Camera,
  CheckCheck,
  DoorOpen,
  Download,
  Eye,
  FilePlus2,
  FileSearch,
  FolderOpen,
  GitBranch,
  Hammer,
  History,
  Layers,
  ListChecks,
  MapPin,
  MessageCircleQuestion,
  MousePointerClick,
  Package,
  PanelRight,
  PenLine,
  Receipt,
  Redo2,
  RefreshCw,
  Ruler,
  Save,
  ScanEye,
  Scissors,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  Undo2,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { Progress } from '@/lib/progress';

/** Sinal de vida do provedor: quanto já chegou, sem o conteúdo privado. */
export type Pulse = { bytes: number; reasoning: number; answer: number; attempt: number };

/** Ferramenta em curso no assistente em laço, com a hora em que começou. */
export type RunningTool = { tool: string; label: string; at: number };

/**
 * Ícone de cada ferramenta do assistente: a linha do progresso diz o que foi
 * feito pelo desenho, não por um ponto colorido igual para tudo.
 */
const TOOL_ICON: Record<string, LucideIcon> = {
  state_read: FileSearch,
  parts_list: Boxes,
  quote_read: Receipt,
  cutplan_read: Scissors,
  design_apply: PenLine,
  row_build: Hammer,
  place: Package,
  modify: SlidersHorizontal,
  room_set: Ruler,
  room_obstacles: MapPin,
  view_camera: Camera,
  view_frame: Camera,
  view_toggle: Eye,
  fronts_open: DoorOpen,
  select: MousePointerClick,
  ui_tab: PanelRight,
  export_file: Download,
  prices_set: Tag,
  history_list: History,
  history_goto: History,
  history_undo: Undo2,
  history_redo: Redo2,
  project_rename: PenLine,
  project_fork: GitBranch,
  project_new: FilePlus2,
  project_list: FolderOpen,
  project_open: FolderOpen,
  plan: ListChecks,
  ask_user: MessageCircleQuestion,
  finish: CheckCheck,
  render_look: ScanEye,
  options_make: Layers,
  fallback: RefreshCw,
};
export function toolIcon(tool: string | undefined): LucideIcon {
  return (tool && TOOL_ICON[tool]) || Wrench;
}

/** Frase de quem está rodando, para ferramentas que não dizem a própria. */
const RUNNING_FALLBACK: Record<string, string> = {
  plan: 'Planejando o trabalho',
  ask_user: 'Vendo se precisa perguntar',
  finish: 'Escrevendo a resposta',
  view_camera: 'Ajustando a vista',
  view_frame: 'Enquadrando o móvel',
  view_toggle: 'Ajustando a vista',
  fronts_open: 'Abrindo as frentes',
  select: 'Selecionando as peças',
  ui_tab: 'Abrindo o painel',
  export_file: 'Preparando o arquivo',
  history_list: 'Lendo as versões',
  history_goto: 'Abrindo a versão',
  history_undo: 'Desfazendo',
  history_redo: 'Refazendo',
  project_rename: 'Renomeando o projeto',
  project_list: 'Lendo os projetos',
  project_open: 'Abrindo o projeto',
};
export function runningLabel(r: { tool: string; label: string }) {
  return r.label && r.label !== 'Trabalhando' ? r.label : (RUNNING_FALLBACK[r.tool] ?? 'Trabalhando');
}

/** Etapas do caminho sem ferramentas (pedido único à IA). */
export type StageId = 'send' | 'think' | 'write' | 'check' | 'review' | 'apply';
export const STAGES: { id: StageId; label: string; active: string; icon: LucideIcon }[] = [
  { id: 'send', label: 'Pedido enviado', active: 'Enviando o pedido e o projeto', icon: Send },
  { id: 'think', label: 'Pedido entendido', active: 'Pensando no seu pedido', icon: Brain },
  { id: 'write', label: 'Proposta escrita', active: 'Escrevendo a proposta', icon: PenLine },
  { id: 'check', label: 'Medidas conferidas', active: 'Conferindo medidas e encaixes', icon: ShieldCheck },
  { id: 'review', label: 'Desenho comparado', active: 'Comparando o desenho com a foto', icon: ScanEye },
  { id: 'apply', label: 'Versão salva', active: 'Salvando a versão', icon: Save },
];

export function stageOf(stage: Progress['stage'] | undefined): StageId {
  if (stage === 'applying' || stage === 'saving') return 'apply';
  if (stage === 'reviewing') return 'review';
  if (stage === 'validating') return 'check';
  if (stage === 'proposing') return 'write';
  if (stage === 'interpreting' || stage === 'connecting' || stage === 'retrying') return 'think';
  return 'send';
}
/** Em que etapa o turno está, pelo último evento e pelo que já chegou. */
export function currentStage(events: readonly Progress[], pulse: Pulse | null): StageId {
  const step = stageOf(events.at(-1)?.stage);
  if (step === 'think' && pulse && pulse.answer > 0) return 'write';
  if (step === 'send' && pulse) return 'think';
  return step;
}

export type Activity = { key: string; label: string; icon: LucideIcon };

/**
 * O que está acontecendo agora, numa fonte só para o cartão da conversa, o
 * selo da cena e o cabeçalho. No assistente em laço: a ferramenta rodando;
 * entre uma e outra, a IA decidindo o próximo passo (não a última etapa, que
 * já terminou). No fim, a gravação da versão.
 */
export function currentActivity(
  events: readonly Progress[],
  pulse: Pulse | null,
  agent?: { steps: number; running: RunningTool | null } | null,
): Activity {
  const stage = currentStage(events, pulse);
  if (agent && (stage === 'think' || stage === 'write')) {
    if (agent.running)
      return { key: `run:${agent.running.tool}:${agent.running.at}`, label: runningLabel(agent.running), icon: toolIcon(agent.running.tool) };
    if (agent.steps > 0) return { key: `think:${agent.steps}`, label: 'Decidindo o próximo passo', icon: Brain };
  }
  const s = STAGES.find((v) => v.id === stage)!;
  return { key: `stage:${stage}`, label: s.active, icon: s.icon };
}

/**
 * Selo animado da atividade: o ícone do que está rodando dentro de um anel
 * que gira. O ícone troca com um leve deslize quando a atividade muda.
 */
export function ActivityGlyph({ activity, size = 'md' }: { activity: Activity; size?: 'sm' | 'md' }) {
  const Icon = activity.icon;
  return (
    <span className={'activity-glyph ' + size} aria-hidden="true">
      <span className="ag-ring" />
      <Icon key={activity.key} className="ag-icon" size={size === 'sm' ? 12 : 16} strokeWidth={2.1} />
    </span>
  );
}

export function clock(ms: number) {
  const s = Math.max(0, ms) / 1000;
  return s < 60 ? `${s.toFixed(1).replace('.', ',')} s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
