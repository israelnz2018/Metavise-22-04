// MÉTRICAS REAIS sem conectar a conta do Meta — importa o relatório CSV que o
// Ads Manager já exporta (Relatórios → Exportar → CSV). Zero chamada de API,
// zero risco pra conta (a conexão direta está desligada de propósito, ver
// metaAds.ts). O usuário exporta, arrasta o arquivo aqui, e os números caem
// nas colunas da tabela de Performance.
//
// Os nomes de coluna do Meta variam por idioma da conta e por quais colunas
// o usuário escolheu no relatório — por isso o mapeamento é por ALIAS
// (lista de nomes possíveis por campo), não por posição fixa.

import type { CreativeMetrics } from './metaAds';

/** Parser de CSV simples mas correto: lida com campos entre aspas (podendo
 *  conter vírgula/quebra de linha) e aspas escapadas (""). Suficiente pro
 *  export do Meta Ads Manager — não precisamos de uma lib externa pra isso. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\r') {
      // ignora — \n cuida da quebra
    } else if (c === '\n') {
      pushRow();
    } else {
      field += c;
    }
  }
  // Última linha sem \n final.
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((r) => r.length > 1 || (r[0] || '').trim() !== '');
}

// Alias por campo — cobre export em PT-BR e EN-US, que são os dois idiomas
// de conta mais comuns. Comparação normalizada (minúsculo, sem acento).
const FIELD_ALIASES: Record<string, string[]> = {
  name: ['ad name', 'nome do anuncio', 'nome do anúncio'],
  campaign: ['campaign name', 'nome da campanha'],
  spend: [
    'amount spent (usd)',
    'amount spent (brl)',
    'amount spent',
    'valor usado (brl)',
    'valor usado (usd)',
    'valor usado',
  ],
  impressions: ['impressions', 'impressoes', 'impressões'],
  clicks: ['link clicks', 'clicks (all)', 'cliques no link', 'cliques (todos)'],
  ctr: ['ctr (all)', 'ctr (link click-through rate)', 'ctr'],
  purchases: ['purchases', 'results', 'compras', 'resultados'],
  cpa: ['cost per purchase', 'cost per result', 'custo por compra', 'custo por resultado'],
  roas: ['purchase roas (return on ad spend)', 'purchase roas', 'roas'],
  frequency: ['frequency', 'frequencia', 'frequência'],
};

function normalize(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function toNumber(raw: string | undefined): number {
  if (!raw) return 0;
  // Meta usa "1,234.56" (EN) ou "1.234,56" (BR) dependendo da conta — remove
  // tudo que não é dígito/ponto/vírgula/sinal, depois normaliza pro formato JS.
  const cleaned = raw.replace(/[^\d.,-]/g, '');
  if (!cleaned) return 0;
  // Se tem os dois separadores, o ÚLTIMO é o decimal.
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized = cleaned;
  if (lastComma > -1 && lastDot > -1) {
    normalized =
      lastComma > lastDot
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (lastComma > -1) {
    // só vírgula — decimal se tiver 1-2 dígitos depois, senão milhar
    normalized = /,\d{1,2}$/.test(cleaned) ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

export interface ImportedMetricsResult {
  metrics: CreativeMetrics[];
  /** Colunas do CSV que não foram reconhecidas — útil pra avisar o usuário
   *  se algum campo esperado (ex.: spend) não foi encontrado. */
  unmatchedFields: string[];
}

/** Lê o CSV exportado do Meta Ads Manager e devolve as métricas por linha
 *  (1 linha = 1 anúncio, tipicamente). Não faz matching com os criativos do
 *  Metavise ainda — isso é responsabilidade de quem chama (precisa comparar
 *  nome do anúncio com nome do subprojeto). */
export function parseMetaCsvReport(csvText: string): ImportedMetricsResult {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return { metrics: [], unmatchedFields: [] };
  const header = rows[0]!.map(normalize);

  // Resolve o índice de cada campo pelo alias que casar primeiro.
  const colIndex: Record<string, number> = {};
  const unmatchedFields: string[] = [];
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx === -1) {
      if (field !== 'campaign' && field !== 'frequency') unmatchedFields.push(field);
    } else {
      colIndex[field] = idx;
    }
  }

  const metrics: CreativeMetrics[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const name = colIndex.name !== undefined ? (r[colIndex.name] || '').trim() : '';
    if (!name) continue;
    const spend = toNumber(r[colIndex.spend!]);
    const impressions = Math.round(toNumber(r[colIndex.impressions!]));
    const clicks = Math.round(toNumber(r[colIndex.clicks!]));
    const ctrRaw =
      colIndex.ctr !== undefined
        ? toNumber(r[colIndex.ctr])
        : impressions > 0
          ? (clicks / impressions) * 100
          : 0;
    const purchases = Math.round(toNumber(r[colIndex.purchases!]));
    const cpa =
      colIndex.cpa !== undefined
        ? toNumber(r[colIndex.cpa])
        : purchases > 0
          ? spend / purchases
          : 0;
    const roas = colIndex.roas !== undefined ? toNumber(r[colIndex.roas]) : 0;
    const frequency =
      colIndex.frequency !== undefined ? toNumber(r[colIndex.frequency]) : undefined;
    metrics.push({
      creativeId: '', // preenchido no matching
      name,
      campaign: colIndex.campaign !== undefined ? r[colIndex.campaign] : undefined,
      spend,
      impressions,
      clicks,
      ctr: ctrRaw,
      cpa,
      roas,
      purchases,
      frequency,
    });
  }
  return { metrics, unmatchedFields };
}

/** Acha a melhor linha do CSV pra um nome de subprojeto — substring
 *  bidirecional, normalizado. Não é fuzzy matching sofisticado; nomear os
 *  anúncios no Meta parecido com o nome do subprojeto resolve a maioria. */
export function matchMetricsToName(
  name: string,
  candidates: CreativeMetrics[]
): CreativeMetrics | null {
  const target = normalize(name);
  if (!target) return null;
  let best: CreativeMetrics | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const cn = normalize(c.name);
    if (!cn) continue;
    let score = 0;
    if (cn === target) score = 100;
    else if (cn.includes(target) || target.includes(cn)) score = Math.min(cn.length, target.length);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore > 0 ? best : null;
}
