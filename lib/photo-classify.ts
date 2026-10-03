/**
 * Classificação rápida da foto de referência (Perplexity Decisions,
 * `pplx-decider-v1-27b`): ativo da biblioteca, ambiente, estilo, acabamento e
 * cor do corpo e faixas de medida, em ~1 s e ~US$ 0,0007 por foto. Roda logo
 * depois do envio da foto, em paralelo com a pessoa escrevendo, e o resultado
 * fica junto da imagem para os pedidos seguintes.
 *
 * As opções de cada pergunta saem do catálogo (ativos, estilos, chapas): um
 * ativo ou estilo novo entra sozinho, sem lista à parte para esquecer.
 *
 * Medido nas fotos de bench/images: ativo e ambiente acertam bem (guarda-roupa
 * 93%, cozinha 69%, ambiente 94%+), cor do corpo razoável (nogueira 82%,
 * branco 76%), estilo fraco (muitas vezes abaixo de 50%) e as faixas de medida
 * são grosseiras. Por isso só o que passa do limiar (PHOTO.confident) vale
 * como ponto de partida; o resto vai para a IA como dica.
 *
 * Sem chave, com erro ou com demora, devolve null e a foto segue como antes:
 * a classificação acelera, nunca é obrigatória.
 */
import { assetById, assets, CATEGORY_LABEL, type AssetCategory } from './assets';
import { materials, type SheetId } from './furniture';
import { imageFile, readStoredMeta, writeStoredMeta } from './images';
import { STYLE_IDS, type StyleId } from './look';
import { STYLES } from './styles';
import { jpegWithin } from '#platform';

const ENDPOINT = 'https://api.perplexity.ai/v1/decisions';
const MODEL = 'pplx-decider-v1-27b';
const TIMEOUT_MS = 5000;
/** A API lê a imagem em ladrilhos de 32 px, até 2048; com folga para o arredondamento. */
export const MAX_TILES = 1800;

/** Limiar de confiança: abaixo dele o campo é só dica para a IA. */
export const PHOTO_CONFIDENT = 0.5;

export type Band = { min: number; max: number };
export type Guess<T> = { value: T; confidence: number };
export type PhotoClassification = {
  /** Id do ativo da biblioteca, ou `other` quando nenhum serve. */
  asset?: Guess<string>;
  room?: Guess<AssetCategory>;
  style?: Guess<StyleId>;
  bodyFinish?: Guess<'wood' | 'plain'>;
  bodyColor?: Guess<SheetId>;
  width?: Guess<Band>;
  height?: Guess<Band>;
  depth?: Guess<Band>;
};

// Descrições em inglês, escritas à mão onde o texto do catálogo é curto
// demais para o modelo (testado em G:\DecisionAPI\playground\merce-pack.js).
// Ativo ou estilo sem linha aqui usa o nome e o resumo do catálogo.
export const ASSET_HINTS: Record<string, string> = {
  'rack-tv': 'low TV unit, doors at the ends, niches and drawers in the middle',
  'rack-suspenso': 'wall panel behind the TV with a wall-hung rack (drawers and niches)',
  rack: 'low TV rack between two tall towers of open niches',
  estante: 'bookcase of equal open niche bodies, doors at the bottom centre',
  aparador: 'buffet / sideboard, doors at the ends and drawers in the middle',
  'guarda-roupa': 'wardrobe with hanging space, drawers and doors, storage box on top',
  comoda: 'wide chest of drawers, about four drawers per column',
  'criado-mudo': 'bedside table with a drawer on top and a niche below',
  cabeceira: 'headboard wall panel with two wall-hung bedside units',
  cozinha: 'kitchen run, base cabinets with drawers and doors plus wall cabinets above',
  'balcao-cozinha': 'single kitchen base cabinet / sink cabinet with a drawer stack',
  'aereo-cozinha': 'wall-hung cabinet with doors, fixed to the wall',
  'gabinete-banheiro': 'wall-hung bathroom vanity with drawers under the basin',
  'armario-escritorio': 'office cabinet, doors at the bottom for files, open niches on top',
  sapateira: 'entrance shoe cabinet with niches, a door and drawers',
  'armario-lavanderia': 'tall laundry cabinet, broom cupboard next to doors and a niche',
  escrivaninha: 'desk on legs with a drawer under the top',
  'escrivaninha-suspensa': 'wall-mounted desk top with a drawer, no legs on the floor',
  console: 'narrow entrance or living-room table with a drawer and a lower shelf',
  'mesa-centro': 'low coffee table with a lower shelf',
  'mesa-lateral': 'small side table next to a sofa or armchair',
  'mesa-jantar': 'dining table for four to eight people',
  banco: 'entrance or end-of-bed bench with a shoe shelf',
  'estante-aberta': 'shelves on an open steel frame, open on all four sides',
  'carrinho-bar': 'bar cart on casters with two levels for bottles and glasses',
  adega: 'wine rack, grid of niches for bottles lying down',
  penteadeira: 'dressing / makeup table with drawers and a glass top',
  'estante-tv': 'niches framing the TV, side towers, bridge on top and rack below',
  entrada: 'entrance bench with shoe shelf and a hook panel on the wall',
  'estante-desencontrada': 'columns with shelves at staggered heights, no back, on a base',
};
export const STYLE_HINTS: Partial<Record<StyleId, string>> = {
  industrial: 'oak and black steel, metal outline, tube feet, steel-mesh doors, bar handles',
  midcentury: 'mid-century: walnut on splayed legs, cut-out handles, low and long',
  scandinavian: 'white with light ash tapered legs, wooden knobs, open shelving',
  minimalist: 'plain graphite, no visible handles (routed groove), recessed plinth, sliding or flap doors, LED',
  rustic: 'solid pine, shaker fronts, thick solid top, square legs, bronze cup handles',
  classic: 'cream with shaker fronts, brass knobs, bun feet, marble top, top cornice',
  japandi: 'slatted ash on a low dark-wood base, no visible handles, open shelving',
  boho: 'light oak with cane doors, leather strap handles, tapered legs, terracotta back',
  brazilian: 'freijó wood with cane, thin palito legs, groove handles, low and long',
  artdeco: 'black with brass, ribbed-glass doors, bar handles, brass legs, chamfered marble top',
  provencal: 'white with raised-panel framed doors, turned legs, bronze knobs, oak top, cornice',
  coastal: 'coastal: white and light blue slatted fronts, wooden knobs, square legs, ash top',
};
export const SHEET_HINTS: Partial<Record<SheetId, string>> = {
  white: 'matte white',
  sand: 'sand / cream / beige plain',
  oak: 'natural oak wood grain, medium-light',
  freijo: 'golden-brown wood grain',
  walnut: 'dark brown walnut wood grain',
  sage: 'sage green plain',
  petrol: 'dark petrol blue plain',
  graphite: 'dark grey plain',
  black: 'matte black',
  pine: 'pale yellowish pine wood grain',
  ash: 'very light ash wood grain',
  smoked: 'very dark smoked oak wood grain',
  terracotta: 'terracotta / rust orange plain',
  sky: 'light sky blue plain',
};
const ROOM_HINTS: Record<AssetCategory, string> = {
  sala: 'living room',
  quarto: 'bedroom',
  cozinha: 'kitchen or bathroom',
  escritorio: 'office / study',
  servico: 'entrance hall or laundry',
};

/** Chapas do catálogo: o corpo do móvel é sempre chapa. */
export const SHEETS = materials.filter((m) => m.category === 'sheet') as Extract<(typeof materials)[number], { category: 'sheet' }>[];

/** Réguas da foto: as mesmas do bloco de foto do prompt (lib/agent/prompt.ts). */
const RULERS =
  'Use known sizes as rulers: a door is 80 cm wide and 2.1 m tall, a kitchen counter is 90 cm high, a wall outlet sits 30 cm up, a ceiling is about 2.6 m, a drawer front is about 20 cm tall, a fridge is about 1.75 m.';

export const CONTEXT =
  'Photo of furniture a customer wants to recreate in Merce, a planned-furniture studio. Judge the main furniture piece; ignore beds, appliances and decoration.';

type ChoiceQuestion = { type: 'choice'; instructions: string; criteria: Record<string, string> };

/** Perguntas da chamada; as chaves das opções são os ids do Merce. */
export function photoQuestions(): Record<string, ChoiceQuestion> {
  const choice = (instructions: string, criteria: Record<string, string>): ChoiceQuestion => ({ type: 'choice', instructions, criteria });
  return {
    asset: choice('Which Merce furniture template is the closest match to the main furniture piece in the image?', {
      ...Object.fromEntries(assets.map((a) => [a.id, `${a.name}: ${ASSET_HINTS[a.id] ?? a.summary}`])),
      other: "None of these: some other piece, or not a furniture piece Merce builds",
    }),
    room: choice(
      'Which room does this furniture belong to?',
      Object.fromEntries(Object.entries(CATEGORY_LABEL).map(([id, name]) => [id, `${name}: ${ROOM_HINTS[id as AssetCategory]}`])),
    ),
    style: choice(
      'Which Merce style best matches the look of the furniture?',
      Object.fromEntries(STYLE_IDS.map((id) => [id, `${STYLES[id].name}: ${STYLE_HINTS[id] ?? STYLES[id].summary}`])),
    ),
    body_material: choice("What does the surface of the furniture's main body (sides and carcass) look like?", {
      wood: 'Wood: visible wood grain (real wood or wood-look board)',
      plain: 'Plain colour: smooth painted, lacquered or plain-colour board with no wood grain',
    }),
    body_color: choice(
      'Which Merce finish best matches the colour of the main body (sides and carcass)? Match wood tones to the wood finishes and plain colours to the plain ones.',
      Object.fromEntries(SHEETS.map((m) => [m.id, `${m.name}: ${SHEET_HINTS[m.id] ?? (m.finish === 'wood' ? 'wood grain' : 'plain colour')} (${m.color})`])),
    ),
    width_mm: choice(`Estimate the total width of the main furniture piece. ${RULERS}`, {
      '0-600': 'Under 60 cm wide',
      '600-1200': '60 cm to 1.2 m wide',
      '1200-1800': '1.2 to 1.8 m wide',
      '1800-2400': '1.8 to 2.4 m wide',
      '2400-3000': '2.4 to 3 m wide',
      '3000-6000': 'Over 3 m wide',
    }),
    height_mm: choice(`Estimate the height of the main furniture piece, from the floor (or its bottom if wall-hung) to its top. ${RULERS}`, {
      '0-500': 'Under 50 cm tall',
      '500-900': '50 to 90 cm tall',
      '900-1200': '90 cm to 1.2 m tall',
      '1200-1800': '1.2 to 1.8 m tall',
      '1800-2400': '1.8 to 2.4 m tall',
      '2400-3000': 'Over 2.4 m tall (up to the ceiling)',
    }),
    depth_mm: choice(`Estimate the depth of the main furniture piece (front to back). ${RULERS}`, {
      '0-250': 'Under 25 cm deep (wall panel, shelf)',
      '250-400': '25 to 40 cm deep (bookcase, rack, wall cabinet)',
      '400-500': '40 to 50 cm deep (sideboard, chest of drawers)',
      '500-650': '50 to 65 cm deep (wardrobe, kitchen counter)',
      '650-1200': 'Over 65 cm deep (table, desk)',
    }),
  };
}

type ChoiceAnswer = { choice?: unknown; confidence?: unknown };

/**
 * Respostas da API viram a classificação. Escolha fora das opções ou
 * confiança que não é número some: campo ausente vale como "não sei".
 */
export function parseAnswers(answers: Record<string, ChoiceAnswer | undefined>): PhotoClassification {
  const questions = photoQuestions();
  const pick = (name: string) => {
    const a = answers[name];
    if (!a || typeof a.choice !== 'string' || !(a.choice in questions[name].criteria)) return undefined;
    const confidence = typeof a.confidence === 'number' && Number.isFinite(a.confidence) ? Math.max(0, Math.min(1, a.confidence)) : 0;
    return { value: a.choice, confidence };
  };
  const band = (name: string): Guess<Band> | undefined => {
    const g = pick(name);
    if (!g) return undefined;
    const [min, max] = g.value.split('-').map(Number);
    return { value: { min, max }, confidence: g.confidence };
  };
  const out: PhotoClassification = {
    asset: pick('asset'),
    room: pick('room') as Guess<AssetCategory> | undefined,
    style: pick('style') as Guess<StyleId> | undefined,
    bodyFinish: pick('body_material') as Guess<'wood' | 'plain'> | undefined,
    bodyColor: pick('body_color') as Guess<SheetId> | undefined,
    width: band('width_mm'),
    height: band('height_mm'),
    depth: band('depth_mm'),
  };
  for (const k of Object.keys(out) as (keyof PhotoClassification)[]) if (!out[k]) delete out[k];
  return out;
}

export function classifierAvailable() {
  return Boolean(process.env.PERPLEXITY_API_KEY) && process.env.MERCE_PHOTO_CLASSIFY !== '0';
}

/** Uma chamada à API com a foto em data URL; null em qualquer falha. */
export async function classifyPhoto(imageUrl: string): Promise<PhotoClassification | null> {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key || process.env.MERCE_PHOTO_CLASSIFY === '0') return null;
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: MODEL,
        state: [
          { type: 'text', text: CONTEXT },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
        questions: photoQuestions(),
      }),
    });
    if (!r.ok) return null;
    const body = (await r.json()) as { answers?: Record<string, ChoiceAnswer> };
    if (!body.answers || typeof body.answers !== 'object') return null;
    const parsed = parseAnswers(body.answers);
    return Object.keys(parsed).length ? parsed : null;
  } catch {
    return null;
  }
}

// Uma chamada por foto: o pedido do navegador logo depois do envio e o turno
// que chega antes dela terminar esperam a mesma promessa. Foto que falhou não
// tenta de novo neste processo, para não somar 5 s a cada pedido.
const pending = new Map<string, Promise<PhotoClassification | null>>();
const failed = new Set<string>();

/** A classificação já gravada com a foto, sem chamar a API. */
export async function storedClassification(id: string): Promise<PhotoClassification | null> {
  try {
    return (JSON.parse(await readStoredMeta(id)) as { classification?: PhotoClassification }).classification ?? null;
  } catch {
    return null;
  }
}

/**
 * A classificação da foto: a gravada, a que está em curso ou uma chamada
 * nova, que fica gravada na metadata da imagem. Nunca lança.
 */
export async function imageClassification(id: string): Promise<PhotoClassification | null> {
  const stored = await storedClassification(id);
  if (stored) return stored;
  if (!classifierAvailable() || failed.has(id)) return null;
  let run = pending.get(id);
  if (!run) {
    run = (async () => {
      try {
        const image = await jpegWithin(await imageFile(id), MAX_TILES * 32 * 32);
        const result = await classifyPhoto(`data:${image.type};base64,` + Buffer.from(image.bytes).toString('base64'));
        if (!result) {
          failed.add(id);
          return null;
        }
        const meta = JSON.parse(await readStoredMeta(id)) as Record<string, unknown>;
        await writeStoredMeta(id, JSON.stringify({ ...meta, classification: result }));
        return result;
      } catch {
        failed.add(id);
        return null;
      } finally {
        pending.delete(id);
      }
    })();
    pending.set(id, run);
  }
  return run;
}

/** Campo acima do limiar. A cor só vale se não contradiz o acabamento seguro (madeira contra liso). */
export function isSure(c: PhotoClassification, key: keyof PhotoClassification) {
  const g = c[key];
  if (!g || g.confidence < PHOTO_CONFIDENT) return false;
  if (key === 'bodyColor' && c.bodyFinish && c.bodyFinish.confidence >= PHOTO_CONFIDENT) {
    const finish = SHEETS.find((m) => m.id === c.bodyColor!.value)?.finish;
    if ((finish === 'wood') !== (c.bodyFinish.value === 'wood')) return false;
  }
  return true;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const mm = (b: Band) => `${b.min}–${b.max} mm`;

/**
 * Bloco compacto para a IA: cada campo com a confiança, e "incerto" no que
 * fica abaixo do limiar. Vazio quando não há classificação.
 */
export function classificationLine(c: PhotoClassification | null) {
  if (!c) return '';
  const parts: string[] = [];
  const field = (key: keyof PhotoClassification, label: string, text: string) => {
    const g = c[key]!;
    parts.push(`${label} ${text} (${pct(g.confidence)}${isSure(c, key) ? '' : ', incerto'})`);
  };
  if (c.asset) field('asset', 'ativo', c.asset.value === 'other' ? 'nenhum da biblioteca' : c.asset.value);
  if (c.room) field('room', 'ambiente', c.room.value);
  if (c.style) field('style', 'estilo', c.style.value);
  if (c.bodyFinish) field('bodyFinish', 'corpo', c.bodyFinish.value === 'wood' ? 'madeira' : 'cor lisa');
  if (c.bodyColor) field('bodyColor', 'cor do corpo', c.bodyColor.value);
  if (c.width) field('width', 'largura', mm(c.width.value));
  if (c.height) field('height', 'altura', mm(c.height.value));
  if (c.depth) field('depth', 'profundidade', mm(c.depth.value));
  return parts.length ? `Classificação rápida da foto (outro modelo, só a peça principal; % é a confiança): ${parts.join('; ')}.` : '';
}

export type PhotoChip = { label: string; title: string; sure: boolean };

const cm = (b: Band) => (b.min === 0 ? `até ${b.max / 10}` : `${b.min / 10}–${b.max / 10}`);

/** O que a interface mostra na foto anexada, em português. */
export function classificationChips(c: PhotoClassification | null): PhotoChip[] {
  if (!c) return [];
  const chips: PhotoChip[] = [];
  const chip = (key: keyof PhotoClassification, label: string, what: string) => {
    const g = c[key]!;
    chips.push({ label, title: `${what}: ${label} (${pct(g.confidence)} de confiança)`, sure: isSure(c, key) });
  };
  const asset = c.asset && c.asset.value !== 'other' ? assetById(c.asset.value) : undefined;
  if (asset) chip('asset', asset.name, 'Móvel');
  if (c.room) chip('room', CATEGORY_LABEL[c.room.value], 'Ambiente');
  if (c.style) chip('style', STYLES[c.style.value].name, 'Estilo');
  if (c.bodyColor) chip('bodyColor', SHEETS.find((m) => m.id === c.bodyColor!.value)?.name ?? c.bodyColor.value, 'Cor do corpo');
  if (c.width && c.height && c.depth) {
    const label = `${cm(c.width.value)} × ${cm(c.height.value)} × ${cm(c.depth.value)} cm`;
    const low = Math.min(c.width.confidence, c.height.confidence, c.depth.confidence);
    chips.push({ label, title: `Medida aproximada (largura × altura × profundidade), ${pct(low)} de confiança na menos certa`, sure: low >= PHOTO_CONFIDENT });
  }
  return chips;
}
