/**
 * UX13 — Content Risk Scanner: lista curada de termos que podem causar:
 *   • Reprovação automática no Meta Ads (Facebook/Instagram)
 *   • Bloqueio total da conta de anúncios (reincidência)
 *   • Cease & desist / ação legal de farmacêuticas e celebridades
 *   • Redução de alcance ("shadow ban") por linguagem flagrada
 *
 * Lista NÃO É EXAUSTIVA — é um "smoke detector" pros casos mais comuns.
 * Cliente deve revisar manualmente também. Fácil de estender: adicione
 * entradas no array RISK_TERMS abaixo.
 *
 * IMPORTANTE: padrões de slurs/discriminação são regex que casam variações
 * sem soletrar a palavra ofensiva por inteiro no fonte. É padrão em libs
 * de moderação de conteúdo (bad-words, leo-profanity, etc).
 */

export type RiskCategory =
  | 'medication' // gabapentin, ozempic, etc — bloqueio + processo de farmacêutica
  | 'celebrity' // uso indevido de imagem de famoso — processo
  | 'discrimination' // sexismo, racismo, homofobia, capacitismo — ban automático
  | 'comparative_claim' // "ao contrário do X" — comparação nominal direta
  | 'reach_reducing' // shadow ban: cura definitiva, milagre, antes/depois
  | 'medical_claim' // alegações médicas não-comprovadas
  | 'cliche_ai'; // UX25-A1: "AI smell" — clichês que denunciam IA / qualidade ruim

export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface RiskTerm {
  /** Padrão de match. String é tratada como substring case-insensitive
   *  com word-boundaries. Use `isRegex: true` pra casos com variações. */
  pattern: string;
  isRegex?: boolean;
  category: RiskCategory;
  severity: RiskSeverity;
  /** Label legível pro user (mostrado no banner) */
  label: string;
  /** Razão curta (1 linha) explicando o risco */
  reason: string;
}

// ─── MEDICAMENTOS ────────────────────────────────────────────────────
// Nome de remédio concorrente é o vilão #1 em saúde no Meta Ads. Inclui
// PT + EN porque muitos clientes anunciam em ambos os mercados.
const MEDICATIONS: RiskTerm[] = [
  // Dor / neuropatia
  { pattern: 'gabapentina', category: 'medication', severity: 'high', label: 'Gabapentina', reason: 'Nome de medicamento concorrente — Meta Ads costuma reprovar automaticamente.' },
  { pattern: 'gabapentin', category: 'medication', severity: 'high', label: 'Gabapentin', reason: 'Nome de medicamento concorrente — Meta Ads costuma reprovar automaticamente.' },
  { pattern: 'pregabalina', category: 'medication', severity: 'high', label: 'Pregabalina', reason: 'Medicamento controlado — Meta Ads e ANVISA restringem comparações.' },
  { pattern: 'pregabalin', category: 'medication', severity: 'high', label: 'Pregabalin', reason: 'Medicamento controlado.' },
  { pattern: 'lyrica', category: 'medication', severity: 'high', label: 'Lyrica', reason: 'Marca registrada Pfizer — risco de cease & desist.' },
  { pattern: 'neurontin', category: 'medication', severity: 'high', label: 'Neurontin', reason: 'Marca registrada — risco de cease & desist.' },
  { pattern: 'dipirona', category: 'medication', severity: 'high', label: 'Dipirona', reason: 'Nome de medicamento — Meta costuma reprovar.' },
  { pattern: 'tramadol', category: 'medication', severity: 'high', label: 'Tramadol', reason: 'Medicamento controlado.' },
  // Peso
  { pattern: 'ozempic', category: 'medication', severity: 'critical', label: 'Ozempic', reason: 'Marca Novo Nordisk — alvo frequente de ações legais e ban automático.' },
  { pattern: 'mounjaro', category: 'medication', severity: 'critical', label: 'Mounjaro', reason: 'Marca Eli Lilly — alvo frequente de ações legais.' },
  { pattern: 'wegovy', category: 'medication', severity: 'critical', label: 'Wegovy', reason: 'Marca Novo Nordisk — alta vigilância.' },
  { pattern: 'saxenda', category: 'medication', severity: 'high', label: 'Saxenda', reason: 'Marca registrada.' },
  { pattern: 'semaglutida', category: 'medication', severity: 'high', label: 'Semaglutida', reason: 'Princípio ativo controlado — restrição forte.' },
  { pattern: 'semaglutide', category: 'medication', severity: 'high', label: 'Semaglutide', reason: 'Princípio ativo controlado.' },
  { pattern: 'sibutramina', category: 'medication', severity: 'critical', label: 'Sibutramina', reason: 'Medicamento controlado (tarja) — proibido em ads.' },
  // Sono / ansiedade / depressão
  { pattern: 'rivotril', category: 'medication', severity: 'critical', label: 'Rivotril', reason: 'Tarja preta — proibido em anúncios.' },
  { pattern: 'alprazolam', category: 'medication', severity: 'critical', label: 'Alprazolam', reason: 'Tarja preta.' },
  { pattern: 'clonazepam', category: 'medication', severity: 'critical', label: 'Clonazepam', reason: 'Tarja preta.' },
  { pattern: 'xanax', category: 'medication', severity: 'critical', label: 'Xanax', reason: 'Tarja preta + marca registrada.' },
  { pattern: 'valium', category: 'medication', severity: 'critical', label: 'Valium', reason: 'Tarja preta + marca registrada.' },
  { pattern: 'fluoxetina', category: 'medication', severity: 'high', label: 'Fluoxetina', reason: 'Antidepressivo.' },
  { pattern: 'sertralina', category: 'medication', severity: 'high', label: 'Sertralina', reason: 'Antidepressivo.' },
  { pattern: 'prozac', category: 'medication', severity: 'high', label: 'Prozac', reason: 'Marca registrada.' },
  { pattern: 'zoloft', category: 'medication', severity: 'high', label: 'Zoloft', reason: 'Marca registrada.' },
  // Disfunção erétil
  { pattern: 'viagra', category: 'medication', severity: 'critical', label: 'Viagra', reason: 'Marca Pfizer — alto risco de processo.' },
  { pattern: 'cialis', category: 'medication', severity: 'critical', label: 'Cialis', reason: 'Marca Eli Lilly.' },
  { pattern: 'sildenafil', category: 'medication', severity: 'high', label: 'Sildenafil', reason: 'Princípio ativo controlado.' },
  { pattern: 'tadalafil', category: 'medication', severity: 'high', label: 'Tadalafil', reason: 'Princípio ativo controlado.' },
  // Diabetes / pressão
  { pattern: 'metformina', category: 'medication', severity: 'high', label: 'Metformina', reason: 'Medicamento controlado.' },
  { pattern: 'insulina', category: 'medication', severity: 'high', label: 'Insulina', reason: 'Medicamento controlado.' },
  { pattern: 'glifage', category: 'medication', severity: 'high', label: 'Glifage', reason: 'Marca registrada.' },
  { pattern: 'losartana', category: 'medication', severity: 'high', label: 'Losartana', reason: 'Medicamento controlado.' },
  // OTC populares
  { pattern: 'tylenol', category: 'medication', severity: 'medium', label: 'Tylenol', reason: 'Marca registrada.' },
  { pattern: 'advil', category: 'medication', severity: 'medium', label: 'Advil', reason: 'Marca registrada.' },
  { pattern: 'aspirina', category: 'medication', severity: 'medium', label: 'Aspirina', reason: 'Marca Bayer.' },
];

// ─── CELEBRIDADES (mais usadas em fraude de ads) ─────────────────────
// Foco em quem é vítima frequente de uso indevido em anúncios. Não tenta
// listar tudo — só os de maior risco real.
const CELEBRITIES: RiskTerm[] = [
  { pattern: 'cristiano ronaldo', category: 'celebrity', severity: 'critical', label: 'Cristiano Ronaldo', reason: 'Uso não autorizado — processo + ban Meta.' },
  { pattern: 'lionel messi', category: 'celebrity', severity: 'critical', label: 'Lionel Messi', reason: 'Uso não autorizado.' },
  { pattern: 'elon musk', category: 'celebrity', severity: 'critical', label: 'Elon Musk', reason: 'Uso não autorizado — alvo histórico de fraude em ads.' },
  { pattern: 'bill gates', category: 'celebrity', severity: 'critical', label: 'Bill Gates', reason: 'Uso não autorizado — alvo de fraude.' },
  { pattern: 'jeff bezos', category: 'celebrity', severity: 'critical', label: 'Jeff Bezos', reason: 'Uso não autorizado.' },
  { pattern: 'mark zuckerberg', category: 'celebrity', severity: 'critical', label: 'Mark Zuckerberg', reason: 'Uso não autorizado — irônico em ads do Meta.' },
  { pattern: 'oprah', category: 'celebrity', severity: 'critical', label: 'Oprah', reason: 'Uso não autorizado — vítima histórica de fraude em saúde/emagrecimento.' },
  { pattern: 'kim kardashian', category: 'celebrity', severity: 'critical', label: 'Kim Kardashian', reason: 'Uso não autorizado.' },
  { pattern: 'taylor swift', category: 'celebrity', severity: 'critical', label: 'Taylor Swift', reason: 'Uso não autorizado.' },
  { pattern: 'tony robbins', category: 'celebrity', severity: 'critical', label: 'Tony Robbins', reason: 'Uso não autorizado em desenvolvimento pessoal.' },
  { pattern: 'warren buffett', category: 'celebrity', severity: 'critical', label: 'Warren Buffett', reason: 'Uso não autorizado em finanças/investimentos.' },
  // BR
  { pattern: 'pablo marçal', category: 'celebrity', severity: 'critical', label: 'Pablo Marçal', reason: 'Uso não autorizado em ads brasileiros.' },
  { pattern: 'thiago nigro', category: 'celebrity', severity: 'critical', label: 'Thiago Nigro', reason: 'Uso não autorizado em finanças.' },
  { pattern: 'primo rico', category: 'celebrity', severity: 'high', label: 'Primo Rico', reason: 'Apelido público — uso não autorizado.' },
  { pattern: 'flávio augusto', category: 'celebrity', severity: 'critical', label: 'Flávio Augusto', reason: 'Uso não autorizado.' },
  { pattern: 'roberto justus', category: 'celebrity', severity: 'critical', label: 'Roberto Justus', reason: 'Uso não autorizado.' },
  { pattern: 'silvio santos', category: 'celebrity', severity: 'critical', label: 'Silvio Santos', reason: 'Uso não autorizado.' },
  { pattern: 'jair bolsonaro', category: 'celebrity', severity: 'critical', label: 'Jair Bolsonaro', reason: 'Figura política — risco de bloqueio por conteúdo político.' },
  { pattern: 'lula', category: 'celebrity', severity: 'critical', label: 'Lula', reason: 'Figura política — risco de bloqueio por conteúdo político.' },
  { pattern: 'neymar', category: 'celebrity', severity: 'critical', label: 'Neymar', reason: 'Uso não autorizado.' },
  { pattern: 'anitta', category: 'celebrity', severity: 'critical', label: 'Anitta', reason: 'Uso não autorizado.' },
  { pattern: 'xuxa', category: 'celebrity', severity: 'critical', label: 'Xuxa', reason: 'Uso não autorizado.' },
];

// ─── DISCRIMINAÇÃO ───────────────────────────────────────────────────
// Slurs e framings discriminatórios. Regex casa variações com letras
// substituídas (1 por i, 0 por o, etc) sem soletrar a palavra inteira
// em texto plano. Padrão de libs de moderação tipo bad-words.
const DISCRIMINATION: RiskTerm[] = [
  // Racismo — N-word EN + variações
  { pattern: '\\bn[i1!]+gg?[aeo]r?s?\\b', isRegex: true, category: 'discrimination', severity: 'critical', label: 'slur racial (EN)', reason: 'Linguagem racista — ban automático imediato.' },
  // Racismo PT
  { pattern: '\\bcrioul[oa]s?\\b', isRegex: true, category: 'discrimination', severity: 'critical', label: 'slur racial (PT)', reason: 'Linguagem racista.' },
  { pattern: '\\bnegr[oa]\\s+(suj[oa]|burr[oa]|fedid[oa])\\b', isRegex: true, category: 'discrimination', severity: 'critical', label: 'racismo contextual', reason: 'Linguagem racista.' },
  // Homofobia / transfobia (PT + EN)
  { pattern: '\\bv[i1!]+[ae]d[oa]s?\\b', isRegex: true, category: 'discrimination', severity: 'critical', label: 'slur LGBT (PT)', reason: 'Linguagem homofóbica.' },
  { pattern: '\\bsapat[ãa]o\\b', isRegex: true, category: 'discrimination', severity: 'critical', label: 'slur LGBT (PT)', reason: 'Linguagem homofóbica.' },
  { pattern: '\\bf[a@]+gg?[oa]ts?\\b', isRegex: true, category: 'discrimination', severity: 'critical', label: 'slur LGBT (EN)', reason: 'Linguagem homofóbica.' },
  { pattern: '\\btr[a@]nn[iy]es?\\b', isRegex: true, category: 'discrimination', severity: 'critical', label: 'slur trans (EN)', reason: 'Linguagem transfóbica.' },
  // Capacitismo
  { pattern: '\\bretardad[oa]s?\\b', isRegex: true, category: 'discrimination', severity: 'critical', label: 'capacitismo', reason: 'Linguagem capacitista.' },
  { pattern: '\\bdebil[oi]ides?\\b', isRegex: true, category: 'discrimination', severity: 'critical', label: 'capacitismo', reason: 'Linguagem capacitista.' },
  { pattern: '\\bmongol[oa]\\b(?!.*nacionalidade)', isRegex: true, category: 'discrimination', severity: 'high', label: 'capacitismo', reason: 'Termo capacitista quando usado pejorativamente.' },
  // Sexismo (framings, não slurs)
  { pattern: '\\bmulher de verdade\\b', isRegex: true, category: 'discrimination', severity: 'high', label: 'estereótipo de gênero', reason: 'Framing estereotipado — Meta sinaliza.' },
  { pattern: '\\bhomem de verdade\\b', isRegex: true, category: 'discrimination', severity: 'high', label: 'estereótipo de gênero', reason: 'Framing estereotipado.' },
  { pattern: '\\bmulherzinha\\b', isRegex: true, category: 'discrimination', severity: 'high', label: 'pejorativo de gênero', reason: 'Termo pejorativo.' },
  { pattern: '\\blugar de mulher\\b', isRegex: true, category: 'discrimination', severity: 'high', label: 'estereótipo de gênero', reason: 'Framing sexista.' },
  // Xenofobia
  { pattern: '\\bnordestin[oa]s?\\s+(burr[oa]|sujo|preguicos)', isRegex: true, category: 'discrimination', severity: 'critical', label: 'xenofobia regional', reason: 'Linguagem xenofóbica.' },
];

// ─── REACH-REDUCING / SHADOW BAN ─────────────────────────────────────
// Termos que mesmo legais podem reduzir alcance no Meta Ads. Não causam
// ban direto, mas o algoritmo de delivery deprecia o anúncio.
const REACH_REDUCING: RiskTerm[] = [
  // Promessas absolutas
  { pattern: '\\b100\\s*%\\s*garantid[oa]\\b', isRegex: true, category: 'reach_reducing', severity: 'medium', label: '100% garantido', reason: 'Promessa absoluta reduz alcance.' },
  { pattern: '\\bgarantia total\\b', isRegex: true, category: 'reach_reducing', severity: 'medium', label: 'garantia total', reason: 'Promessa absoluta.' },
  { pattern: '\\bresultado garantido\\b', isRegex: true, category: 'reach_reducing', severity: 'medium', label: 'resultado garantido', reason: 'Promessa absoluta.' },
  { pattern: '\\bsem falhar\\b', isRegex: true, category: 'reach_reducing', severity: 'medium', label: 'sem falhar', reason: 'Promessa absoluta.' },
  // Milagre / cura
  { pattern: '\\bmilagre\\b', isRegex: true, category: 'reach_reducing', severity: 'medium', label: 'milagre', reason: 'Linguagem milagrosa reduz alcance.' },
  { pattern: '\\bmilagros[oa]\\b', isRegex: true, category: 'reach_reducing', severity: 'medium', label: 'milagroso(a)', reason: 'Linguagem milagrosa.' },
  // Antes/depois
  { pattern: '\\bantes\\s+e\\s+depois\\b', isRegex: true, category: 'reach_reducing', severity: 'medium', label: 'antes e depois', reason: 'Meta restringe imagens/textos comparativos pessoais.' },
  { pattern: '\\bbefore\\s*&?\\s*after\\b', isRegex: true, category: 'reach_reducing', severity: 'medium', label: 'before & after', reason: 'Meta restringe comparações pessoais.' },
  // Get rich quick
  { pattern: '\\bfique ric[oa]\\b', isRegex: true, category: 'reach_reducing', severity: 'medium', label: 'fique rico', reason: 'Promessa financeira ampla.' },
  { pattern: '\\bganhe\\s+\\d+\\s+(mil|reais|d[óo]lar|real|por\\s+dia)', isRegex: true, category: 'reach_reducing', severity: 'high', label: 'renda específica', reason: 'Promessa de renda específica reduz alcance e pode reprovar.' },
  { pattern: '\\bget\\s+rich\\b', isRegex: true, category: 'reach_reducing', severity: 'medium', label: 'get rich', reason: 'Promessa financeira.' },
  { pattern: '\\bdinheiro f[áa]cil\\b', isRegex: true, category: 'reach_reducing', severity: 'medium', label: 'dinheiro fácil', reason: 'Promessa financeira.' },
  // Body shaming / weight loss específico
  { pattern: '\\bperc[ae]\\s+\\d+\\s+(kg|quilos|kilos|kilo)\\b', isRegex: true, category: 'medical_claim', severity: 'high', label: 'perde N kg', reason: 'Promessa específica de perda de peso reprova no Meta.' },
  { pattern: '\\blose\\s+\\d+\\s+(lbs?|pounds?|kg)\\b', isRegex: true, category: 'medical_claim', severity: 'high', label: 'lose N lbs', reason: 'Promessa específica de perda de peso.' },
  { pattern: '\\bbarrig[ua]d[ao]s?\\b', isRegex: true, category: 'reach_reducing', severity: 'medium', label: 'barrigudo(a)', reason: 'Body shaming sinalizado pelo Meta.' },
  { pattern: '\\bgordur[ao]\\s+(localizada|na barriga|abdominal)\\b', isRegex: true, category: 'reach_reducing', severity: 'medium', label: 'gordura específica', reason: 'Linguagem corporal específica reduz alcance.' },
  // Conteúdo sexual explícito
  { pattern: '\\bejacul[aá][cç][ãa]o\\b', isRegex: true, category: 'reach_reducing', severity: 'medium', label: 'ejaculação', reason: 'Conteúdo sexual explícito reduz alcance.' },
  { pattern: '\\bere[cç][ãa]o\\b', isRegex: true, category: 'reach_reducing', severity: 'medium', label: 'ereção', reason: 'Conteúdo sexual explícito.' },
  // Suicídio / auto-mutilação
  { pattern: '\\bsuic[íi]dio\\b', isRegex: true, category: 'reach_reducing', severity: 'high', label: 'suicídio', reason: 'Termo sensível — pode bloquear anúncio.' },
  { pattern: '\\bse mat[ae]r\\b', isRegex: true, category: 'reach_reducing', severity: 'high', label: 'se matar', reason: 'Termo sensível.' },
  // COVID / pandemia (ainda restrito)
  { pattern: '\\b(covid|coronavirus|coronav[íi]rus)\\b', isRegex: true, category: 'reach_reducing', severity: 'medium', label: 'COVID', reason: 'Meta restringe ads relacionados a COVID.' },
];

// ─── MEDICAL CLAIMS (alegações médicas não-comprovadas) ──────────────
const MEDICAL_CLAIMS: RiskTerm[] = [
  { pattern: '\\bcura definitiva\\b', isRegex: true, category: 'medical_claim', severity: 'critical', label: 'cura definitiva', reason: 'Alegação médica não-comprovada — reprovação automática.' },
  { pattern: '\\bcura para\\s+(c[âa]ncer|cancer|diabetes|alzheimer|hipertens[ãa]o|depress[ãa]o)', isRegex: true, category: 'medical_claim', severity: 'critical', label: 'cura para doença grave', reason: 'Alegação médica grave — reprovação automática.' },
  { pattern: '\\belimina\\s+(c[âa]ncer|cancer|diabetes|alzheimer)', isRegex: true, category: 'medical_claim', severity: 'critical', label: 'eliminar doença grave', reason: 'Alegação médica grave.' },
  { pattern: '\\btrata\\s+(c[âa]ncer|cancer|diabetes|alzheimer)', isRegex: true, category: 'medical_claim', severity: 'high', label: 'tratar doença grave', reason: 'Alegação médica — Meta restringe.' },
  { pattern: '\\bsubstitui o (rem[ée]dio|medicamento|tratamento)\\b', isRegex: true, category: 'medical_claim', severity: 'high', label: 'substitui medicamento', reason: 'Implica eficácia equivalente a remédio.' },
  { pattern: '\\bsem efeitos colaterais\\b', isRegex: true, category: 'medical_claim', severity: 'medium', label: 'sem efeitos colaterais', reason: 'Alegação médica não-verificável.' },
  { pattern: '\\bcomprovado cientificamente\\b', isRegex: true, category: 'medical_claim', severity: 'medium', label: 'comprovado cientificamente', reason: 'Alegação que exige fonte — Meta pode pedir prova.' },
];

// ─── COMPARATIVE CLAIMS (comparação nominal direta) ──────────────────
const COMPARATIVE: RiskTerm[] = [
  { pattern: '\\bao contr[áa]rio (do|da|dos|das)\\s+[A-Z]\\w+', isRegex: true, category: 'comparative_claim', severity: 'high', label: 'comparação nominal', reason: 'Comparação direta com marca/medicamento — alto risco legal.' },
  { pattern: '\\bdiferente d[oae]s?\\s+[A-Z]\\w+', isRegex: true, category: 'comparative_claim', severity: 'medium', label: 'comparação implícita', reason: 'Comparação pode ser flagrada pelo Meta.' },
  { pattern: '\\bmelhor que\\s+(rem[ée]dio|medicamento|cirurgia)', isRegex: true, category: 'comparative_claim', severity: 'high', label: 'melhor que remédio', reason: 'Comparação implica equivalência a tratamento médico.' },
];

// ─── CLICHÊS / "AI SMELL" ────────────────────────────────────────────
// UX25-A1: frases-padrão que aparecem em copies geradas por IA e
// denunciam o texto como "automático". Não bloqueiam ad, mas reduzem
// conversão porque o leitor reconhece como genérico/superficial. PT + EN.
const CLICHE_AI: RiskTerm[] = [
  // Openers narrativos clichê
  { pattern: 'eu (tava|estava) ouvindo um podcast', isRegex: true, category: 'cliche_ai', severity: 'low', label: 'Opener "ouvindo um podcast"', reason: 'Opener super comum em ads PT-BR — sinaliza copy genérica de IA.' },
  { pattern: '(outro|outro) dia eu (ouvi|li|vi)', isRegex: true, category: 'cliche_ai', severity: 'low', label: 'Opener "outro dia eu ouvi"', reason: 'Setup narrativo clichê.' },
  { pattern: 'um (amigo|amiga) (me )?contou', isRegex: true, category: 'cliche_ai', severity: 'low', label: 'Opener "um amigo me contou"', reason: 'Setup narrativo clichê.' },
  { pattern: 'i was listening to a podcast', isRegex: true, category: 'cliche_ai', severity: 'low', label: 'Opener "listening to a podcast"', reason: 'Common AI cliché opener in EN ads.' },
  // Frases vazias / hype
  { pattern: 'transforma (a |sua )?vida', isRegex: true, category: 'cliche_ai', severity: 'low', label: '"Transforma sua vida"', reason: 'Frase vazia clássica de copy ruim.' },
  { pattern: 'descubra o segredo', category: 'cliche_ai', severity: 'low', label: '"Descubra o segredo"', reason: 'Clichê de IA — abre curiosidade barata.' },
  { pattern: 'mudar (a |sua )?vida para sempre', isRegex: true, category: 'cliche_ai', severity: 'low', label: '"Mudar sua vida para sempre"', reason: 'Promessa vaga / hype gratuito.' },
  { pattern: 'revolucionário', category: 'cliche_ai', severity: 'low', label: '"Revolucionário"', reason: 'Adjetivo inflado — IA puxa muito.' },
  { pattern: 'definitivo', category: 'cliche_ai', severity: 'low', label: '"Definitivo"', reason: 'Promessa absoluta sem nuance.' },
  { pattern: 'incrível', category: 'cliche_ai', severity: 'low', label: '"Incrível"', reason: 'Adjetivo genérico — IA usa muito.' },
  { pattern: 'inacreditável', category: 'cliche_ai', severity: 'low', label: '"Inacreditável"', reason: 'Adjetivo genérico.' },
  { pattern: 'extraordinário', category: 'cliche_ai', severity: 'low', label: '"Extraordinário"', reason: 'Adjetivo inflado.' },
  { pattern: 'no mundo de hoje', category: 'cliche_ai', severity: 'low', label: '"No mundo de hoje"', reason: 'Opener clichê traduzido do inglês ("in today\'s world").' },
  { pattern: 'nesta era', category: 'cliche_ai', severity: 'low', label: '"Nesta era"', reason: 'Opener traduzido — sinaliza IA.' },
  { pattern: 'uma jornada', category: 'cliche_ai', severity: 'low', label: '"Uma jornada"', reason: 'Metáfora batida — IA usa muito.' },
  { pattern: 'está prestes a', category: 'cliche_ai', severity: 'low', label: '"Está prestes a"', reason: 'Construção traduzida do inglês.' },
  { pattern: 'descubra como', category: 'cliche_ai', severity: 'low', label: '"Descubra como"', reason: 'Opener genérico.' },
  // Promessas vagas
  { pattern: 'segredo (que )?ninguém (te )?conta', isRegex: true, category: 'cliche_ai', severity: 'low', label: 'Segredo que ninguém te conta', reason: 'Frase hyper-batida em ads.' },
  { pattern: 'imagine (poder|por um momento)', isRegex: true, category: 'cliche_ai', severity: 'low', label: '"Imagine poder…"', reason: 'Opener clichê de IA.' },
  // EN equivalents
  { pattern: 'game.?changer', isRegex: true, category: 'cliche_ai', severity: 'low', label: '"Game-changer"', reason: 'Overused EN cliché.' },
  { pattern: 'life.?changing', isRegex: true, category: 'cliche_ai', severity: 'low', label: '"Life-changing"', reason: 'Overused EN cliché.' },
  { pattern: 'transform your life', category: 'cliche_ai', severity: 'low', label: '"Transform your life"', reason: 'Overused EN cliché.' },
  { pattern: 'discover the secret', category: 'cliche_ai', severity: 'low', label: '"Discover the secret"', reason: 'Overused EN cliché.' },
  { pattern: 'will change everything', category: 'cliche_ai', severity: 'low', label: '"Will change everything"', reason: 'Overused EN cliché.' },
  // Hedges típicos de IA
  { pattern: 'na verdade', category: 'cliche_ai', severity: 'low', label: '"Na verdade"', reason: 'Hedge muito usado por IA — pode soar artificial em excesso.' },
  { pattern: 'a verdade é que', category: 'cliche_ai', severity: 'low', label: '"A verdade é que"', reason: 'Filler comum em copies geradas.' },
];

export const RISK_TERMS: RiskTerm[] = [
  ...MEDICATIONS,
  ...CELEBRITIES,
  ...DISCRIMINATION,
  ...REACH_REDUCING,
  ...MEDICAL_CLAIMS,
  ...COMPARATIVE,
  ...CLICHE_AI,
];

/** Categoria → label PT pra exibir no banner */
export const CATEGORY_LABELS: Record<RiskCategory, string> = {
  medication: 'Medicamento concorrente',
  celebrity: 'Nome de celebridade',
  discrimination: 'Linguagem discriminatória',
  comparative_claim: 'Comparação direta',
  reach_reducing: 'Reduz alcance no Meta',
  medical_claim: 'Alegação médica',
  cliche_ai: 'Clichê de IA',
};

/** Severidade → cor de UI + label */
export const SEVERITY_META: Record<
  RiskSeverity,
  { label: string; color: string; icon: string }
> = {
  critical: { label: 'CRÍTICO', color: 'red', icon: '🚫' },
  high: { label: 'ALTO', color: 'orange', icon: '⚠️' },
  medium: { label: 'MÉDIO', color: 'amber', icon: 'ℹ️' },
  low: { label: 'AVISO', color: 'gray', icon: '💭' },
};
