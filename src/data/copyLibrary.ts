/**
 * UX14 — System Copy Library
 *
 * Biblioteca curada de exemplos de copy de alta qualidade. Usada como
 * few-shot examples no prompt de geração de copy. Idéia: modelos ficam
 * muito melhores quando têm 2-3 EXEMPLOS reais do estilo desejado em
 * vez de só REGRAS.
 *
 * Cada exemplo é sintético (escrito do zero) mas modelado em padrões de
 * copywriters reconhecidos: Eugene Schwartz, Gary Halbert, Stefan Georgi
 * (RMBC method), Dan Kennedy. Tom direto, especificidade alta, sem
 * "smell de IA" (vícios tipo "no mundo de hoje", "está prestes a", etc).
 *
 * Estrutura: cada copy tem vertical, ângulo, awareness, lingua. O
 * algoritmo de seleção em claudeService escolhe 2-3 mais alinhados ao
 * brief atual e injeta no prompt.
 *
 * Cliente pode adicionar a própria biblioteca via Firestore (UX18) —
 * algoritmo prefere as do cliente, cai pro sistema como fallback.
 */

export type CopyVertical =
  | 'saude' // suplementos, dor, sono, ansiedade, nutrição
  | 'emagrecimento' // perda de peso, diet, fitness, low-carb
  | 'financas' // renda extra, investimento, dropshipping
  | 'info_produto' // curso, mentoria, comunidade
  | 'beleza' // skincare, anti-aging, cabelo
  | 'fisico' // gadget, ferramenta, casa, lifestyle
  | 'espiritual'; // tarot, oração, mapa astral, autoconhecimento

export type AwarenessLevel = '1' | '2' | '3' | '4' | '5';

export interface CopyExample {
  id: string;
  vertical: CopyVertical;
  /** Schwartz awareness: 1=unaware, 5=most aware */
  awareness: AwarenessLevel;
  /** Ângulo principal — frases curtas pra match com brief.angle */
  angle: string;
  /** Idioma. 'pt' inclui PT-BR. 'en' incluí EN-US. */
  language: 'pt' | 'en';
  /** O texto da copy (script completo, ~150-250 palavras) */
  script: string;
  /** Por que essa copy é boa — usado em comentário no prompt pra ancorar
   *  o que o modelo deve imitar. Não é mostrado pro user. */
  whyItWorks: string;
}

// ════════════════════════════════════════════════════════════════════
// PT-BR (16 exemplos)
// ════════════════════════════════════════════════════════════════════

const PT_BR: CopyExample[] = [
  // ─── SAÚDE / SUPLEMENTOS ────────────────────────────────────────
  {
    id: 'saude_pt_1',
    vertical: 'saude',
    awareness: '2',
    angle: 'Diagnóstico único — não é X, é Y',
    language: 'pt',
    script: `Você acorda toda noite com aquela dor formigando nos pés e culpa a idade. Não é a idade.

É uma molécula chamada palmitoiletanolamida que para de ser produzida pelo seu corpo depois dos 50. Sem ela, os nervos ficam expostos — qualquer toque vira queimação.

Médicos passam gabapentina pra mascarar. Mas mascarar não é resolver. A dor volta forte às 3 da manhã, todo santo dia.

Uma cápsula natural feita na Alemanha entrega essa molécula de volta direto no sangue. Em três semanas, mais de 12 mil pessoas pararam de acordar gritando à noite.

Não vai fazer propaganda na TV. A indústria farmacêutica não deixa.

Clica aí embaixo. Vê se você se reconhece no que essa mulher conta.`,
    whyItWorks: 'Abre com momento sensorial específico (3am, pés), reframe diagnóstico ("não é a idade"), explica mecanismo simples mas crível (PEA), prova social com número, CTA suave. Sem "milagre" ou "garantia".',
  },
  {
    id: 'saude_pt_2',
    vertical: 'saude',
    awareness: '3',
    angle: 'Mecanismo único — como funciona diferente',
    language: 'pt',
    script: `Toda noite você toma aquele comprimido amarelo que o médico passou pra dormir.

E acorda no dia seguinte mais cansado do que quando deitou.

Esse comprimido te desliga. Não te faz dormir. Te apaga. Por isso seu cérebro não entra na fase REM, onde o corpo realmente descansa.

Existe uma planta que cresce nas montanhas da Sérvia, chamada valeriana selvagem, que faz o oposto: aumenta a fase REM em 38% sem te apagar.

A diferença é gigante. Você acorda em vez de ressuscitar.

Tem uma cápsula que combina essa valeriana com magnésio glicinato — vendida só pelo site oficial, sem farmácia, sem receita. Quem testa por 21 dias geralmente não volta pro comprimido amarelo.

Aperta no link, lê os depoimentos. Se identificar — você sabe o que fazer.`,
    whyItWorks: 'Pintura sensorial ("cansado do que quando deitou"), diferenciação mecânica concreta (REM vs apagar), número específico (38%), origem geográfica que dá credibilidade ("montanhas da Sérvia"), prova soft, CTA confiante.',
  },
  {
    id: 'saude_pt_3',
    vertical: 'saude',
    awareness: '4',
    angle: 'Comparação contra alternativas',
    language: 'pt',
    script: `Você já testou cinco coisas pra ansiedade. Eu sei porque eu testei seis.

Rivotril me deixou zumbi. Fluoxetina me deixou sem libido. Acupuntura ajudou por duas semanas. Meditação não conseguiu segurar quando o pânico bateu no domingo à noite. Cannabis CBD comprado em farmácia? Diluído demais pra fazer efeito.

O que funcionou pra mim foi ashwagandha KSM-66 em dose de 600mg, duas vezes ao dia. Não é cura. É um adaptógeno que regula cortisol. Tomei por três meses, mudei o jeito que respondo a estresse.

Esse mesmo composto, na mesma dose, tem dentro de uma cápsula chamada (nome do produto). Comprei o primeiro pote testando. Já tô no quinto.

Se você já tentou de tudo, dá uma olhada. Custa menos que três sessões de terapia. Funciona pra mim — pode funcionar pra você.`,
    whyItWorks: 'História pessoal forte, lista específica de coisas tentadas (5 itens com objeção concreta cada), nomes técnicos sem parecer farmácia, comparação financeira com terapia, CTA honesto sem promessa.',
  },
  {
    id: 'saude_pt_4',
    vertical: 'saude',
    awareness: '1',
    angle: 'Revelação — algo que você não sabia',
    language: 'pt',
    script: `Aquela queimação no estômago depois do café da manhã não é gastrite.

É uma bactéria chamada H. pylori que vive no revestimento do seu estômago e fura um buraquinho ali. Toda vez que você come, o ácido entra no buraquinho. É isso que arde.

Sete em cada dez brasileiros têm essa bactéria. A maioria não sabe.

O médico passa Omeprazol, que tampa o ácido temporariamente. A bactéria continua viva e o buraco continua aberto. Você fica refém do remédio.

Existe uma erva chinesa chamada (nome) que age direto na membrana da bactéria. Estudos no Japão mostraram redução de 78% da H. pylori em 6 semanas — sem antibiótico.

Tem uma cápsula que combina essa erva com probióticos no Brasil. Vou deixar o link aqui embaixo. Lê com calma.`,
    whyItWorks: 'Reveia condição que cliente nem sabia ter, prova com estatística "7 em cada 10", expõe limite do tratamento padrão sem demonizar, solução natural com base científica plausível, CTA leitura (não compra direta — awareness 1).',
  },

  // ─── EMAGRECIMENTO ──────────────────────────────────────────────
  {
    id: 'emag_pt_1',
    vertical: 'emagrecimento',
    awareness: '3',
    angle: 'Quebra de paradigma',
    language: 'pt',
    script: `Cortar carboidrato não vai te fazer emagrecer. Vai te fazer odiar tua vida e voltar mais gordo.

A verdade que ninguém te conta: gordura abdominal não é sobre calorias. É sobre cortisol.

Cortisol é o hormônio que o teu corpo libera quando tá estressado. Trabalho, trânsito, filho gritando, conta vencendo. Cortisol alto manda o corpo guardar gordura no abdômen — pra "sobreviver à fome que tá vindo".

Você pode comer salada e correr 5 km todo dia. Se o cortisol tá nas alturas, a barriga não some.

Tem três coisas que baixam cortisol de verdade: ashwagandha, sono real (não esse de seis horas), e parar de cortar carboidrato.

Tem uma cápsula brasileira que combina ashwagandha com inositol e magnésio. Tomou e dormiu — barriga desinflama em duas semanas.

Link abaixo. Não promete milagre. Promete dormir bem.`,
    whyItWorks: 'Contraintuitivo logo de cara, educa sobre cortisol (mecanismo crível), valida o esforço do leitor ("salada e 5km"), promete algo modesto ("dormir bem") em vez de milagre.',
  },
  {
    id: 'emag_pt_2',
    vertical: 'emagrecimento',
    awareness: '2',
    angle: 'Identificação com a dor',
    language: 'pt',
    script: `Você se olha no espelho de manhã e desvia.

Já fez low-carb, já fez jejum, já tentou aquele chá que viraliza. Perde 4 quilos em duas semanas — e ganha 6 no mês seguinte.

A culpa não é tua. É da forma como esses métodos quebram o teu metabolismo.

Tem uma molécula chamada berberina, extraída de uma planta chinesa, que age igual a Ozempic mas sem o efeito colateral. Ela ensina o corpo a queimar gordura como combustível em vez de guardar.

Não é dieta. Não é remédio. É só uma molécula que o teu corpo já reconhece — só que a maioria das pessoas nunca consumiu na dose certa.

Uma cápsula brasileira tá vendendo no Mercado Livre com 12 mil avaliações. Vou deixar o link.

Se você cansou de começar de novo toda segunda, talvez seja a hora de parar de começar e começar a continuar.`,
    whyItWorks: 'Momento universal ("desvia no espelho"), valida frustração com métodos comuns, evita "Ozempic" como afirmação direta ("igual a Ozempic mas") — borderline mas funciona, oferece nova categoria ("não é dieta"), CTA filosófico bonito.',
  },
  {
    id: 'emag_pt_3',
    vertical: 'emagrecimento',
    awareness: '4',
    angle: 'Comparação com competidor (sem nomear)',
    language: 'pt',
    script: `Aquela injeção semanal que tá famosa funciona. Mas tem dois problemas.

Primeiro: custa entre 800 e 1.500 reais por mês, e quando você para, a fome volta com fúria triplicada.

Segundo: precisa de receita, e o desabastecimento tá real — diabéticos não conseguem comprar porque emagrecimento sumiu o estoque.

Existe um composto natural com efeito parecido — não idêntico, parecido — que age no mesmo receptor cerebral da saciedade. Chama-se 5-HTP combinado com cromo picolinato.

Não é "tão forte" quanto a injeção. Mas custa 80 reais por mês, não tem desabastecimento, e quando você para não tem efeito rebote forte.

Tem uma cápsula que combina esses dois ativos. Tá vendendo bem com gente que tava esperando vaga pra fazer a injeção.

Não vai resolver pra todo mundo. Mas vale ver se resolve pra você.`,
    whyItWorks: 'Reconhece o concorrente sem nomear (Ozempic), dois pain points específicos ($, desabastecimento), oferece alternativa modesta ("parecido — não idêntico"), preço comparativo, CTA honesto.',
  },

  // ─── FINANÇAS / RENDA EXTRA ─────────────────────────────────────
  {
    id: 'fin_pt_1',
    vertical: 'financas',
    awareness: '3',
    angle: 'Quebra de paradigma',
    language: 'pt',
    script: `Investir em ação não é investir. É apostar.

Sabe quem ganha dinheiro com ação? Quem vende curso de ação. O analista que aparece na CNN. A corretora que cobra spread.

Você? Você é o produto.

Existe uma classe de ativo que paga 1% ao mês, regulada pelo Banco Central, e ninguém fala dela porque corretora não ganha comissão: CRI/CRA bancário.

São títulos lastreados em recebíveis de imóvel ou agronegócio. Risco baixo, retorno acima da Selic, isento de imposto de renda.

Não vou te ensinar a investir nisso de graça. Mas tem um curso de 4 horas que mostra exatamente quais CRIs comprar em 2025, com auditoria mensal feita por um analista CVM.

Custa o equivalente a uma noite de pizza. Em três meses, paga o investimento de volta com os juros que você teria perdido na renda fixa do banco.

Link na bio. Vê se faz sentido.`,
    whyItWorks: 'Atira em sagrado (ação não funciona), explica mecanismo financeiro com termos reais (CRI/CRA, lastro, CVM), preço relativo a algo cotidiano ("noite de pizza"), promete prazo concreto.',
  },
  {
    id: 'fin_pt_2',
    vertical: 'financas',
    awareness: '2',
    angle: 'Identificação',
    language: 'pt',
    script: `Você abriu o app do banco hoje cedo e teve aquela sensação de aperto no peito.

Salário entrou na sexta. Hoje é quarta. Já foi metade.

Aluguel, conta de luz, mercado, escola do menino, parcela do carro, plano de saúde. Você trabalha pra pagar contas. Pagar contas pra trabalhar.

Não é falta de planilha. Você já tentou planilha. Já cortou Netflix. Já fez bico no fim de semana.

O problema é estrutural: teu salário tá vinculado às tuas horas. E as horas do teu dia são finitas.

Existe um modelo de negócio chamado "ativo digital" que desacopla teu tempo do teu ganho. Você produz uma vez, vende mil vezes. PDF, planilha, template, curso, audiobook.

Tem uma estrutura passo-a-passo pra começar do zero — sem audiência, sem investimento, com 90 dias até a primeira venda. Custa menos que jantar fora.

Link aqui. Não vai mudar tua vida em 7 dias. Em 90 talvez sim.`,
    whyItWorks: 'Momento universal (app do banco), lista de contas que ressoa, valida tentativas ("planilha, Netflix, bico"), introduz nova categoria conceitual ("ativo digital"), promete prazo realista 90 dias (não "ficar rico"), CTA honesto.',
  },

  // ─── INFO-PRODUTO ───────────────────────────────────────────────
  {
    id: 'info_pt_1',
    vertical: 'info_produto',
    awareness: '4',
    angle: 'Autoridade — quem ensina',
    language: 'pt',
    script: `Eu fui demitido três vezes antes dos 30. Achava que era azar.

Hoje eu treino 47 pessoas que faturam 6 dígitos por mês vendendo conhecimento online. E tem uma coisa que TODAS aprenderam comigo na primeira semana — e mudou tudo:

Você não vende cursos. Você vende transformações.

"Curso de Excel" não vende. "Como ganhar mais 3.000 por mês usando uma planilha que teu chefe não sabe que existe" — esse vende todo dia.

A diferença não é o conteúdo. É o posicionamento.

Eu montei uma aula gratuita de 47 minutos onde eu explico essa mudança usando 9 exemplos reais de alunos meus. Quando você termina a aula, você sai sabendo POR QUE teus lançamentos anteriores não venderam.

Não custa nada. Não tem upsell na hora. É só conteúdo.

Quem viu até o final geralmente entra na turma seguinte. Quem entrou na turma fatura. Mas isso é outro papo.

Aperta no link. Te vejo lá dentro.`,
    whyItWorks: 'Vulnerabilidade ("demitido três vezes"), número específico (47 alunos), insight tangível e ensinável (transformações vs cursos), gratuito como entrada de funil, CTA self-confident sem ser arrogante.',
  },
  {
    id: 'info_pt_2',
    vertical: 'info_produto',
    awareness: '3',
    angle: 'Resultado — o que vou conseguir',
    language: 'pt',
    script: `Em 30 dias, você sai do absoluto zero e tem uma audiência de 2 mil pessoas que querem comprar de você.

Sem investimento em tráfego pago. Sem precisar aparecer no vídeo. Sem ter currículo nenhum.

A estratégia chama-se "Outdoor Digital". É colocar conteúdo gratuito em comentários de outros perfis grandes da tua área, de um jeito que parece útil — não spam.

Funciona porque você usa AUDIÊNCIA EXISTENTE em vez de tentar construir a tua do zero.

Eu testei isso por 6 meses em 12 nichos diferentes. Funcionou em 11. O único que não funcionou foi seguros (público idoso, não comenta).

Tem um treinamento de 4 módulos onde eu mostro:
— quais perfis mirar (matriz de 84 critérios)
— como escrever comentários que não são apagados
— como converter visitante em seguidor sem pedir
— como vender pro seguidor sem parecer vendedor

Custa o equivalente a duas pizzas. Funciona em 30 dias. Link abaixo.`,
    whyItWorks: 'Promessa concreta (30 dias, 2 mil pessoas), reconhece restrições do leitor (sem aparecer no vídeo, sem currículo), técnica nova com nome ("Outdoor Digital"), prova com transparência (11 de 12 nichos), preço comparativo.',
  },

  // ─── BELEZA / ANTI-AGING ────────────────────────────────────────
  {
    id: 'beleza_pt_1',
    vertical: 'beleza',
    awareness: '2',
    angle: 'Identificação',
    language: 'pt',
    script: `Aquela ruga no meio da testa apareceu de uma vez aos 38.

Você dormiu sem ela na quinta-feira. Acordou com ela na segunda. Sem aviso.

Tua dermatologista ia te oferecer botox a R$ 1.200, três vezes por ano, pra sempre. Calcule sua vida inteira nessa conta.

Tem uma molécula chamada Argireline. É um peptídeo que faz o que o botox faz — relaxa o músculo que enruga — só que em creme e sem agulha. Aplicado de noite, em 30 dias suaviza 47% da ruga, segundo estudo da Universidade de Barcelona.

Existe um creme brasileiro que combina Argireline com retinol encapsulado. Não é dos baratos. Mas é o equivalente a duas aplicações de botox por ano.

Não vai apagar a ruga em uma semana. Em três meses, você vai parar de pensar nela.

Link na descrição.`,
    whyItWorks: 'Momento específico ("apareceu de uma vez aos 38, sem aviso"), pinta cenário financeiro do tratamento padrão (vida inteira pagando botox), introduz alternativa científica (Argireline com estudo), promessa modesta e realista (3 meses, parar de pensar).',
  },
  {
    id: 'beleza_pt_2',
    vertical: 'beleza',
    awareness: '3',
    angle: 'Mecanismo único',
    language: 'pt',
    script: `Cabelo não cai porque você lava demais. Não cai porque você usa secador. Não cai por estresse.

Cabelo cai porque o teu folículo capilar ficou sem DHT-bloqueio.

DHT é um subproduto da testosterona que entope o folículo por dentro. Em homens com 30+, é a causa de 9 em cada 10 casos de calvície. Em mulheres com 40+, é o que causa aquele "afinamento" no topo da cabeça.

Minoxidil masca o problema crescendo cabelos finos. Não resolve a causa.

Existe uma combinação de saw palmetto com biotina e zinco que bloqueia o DHT no folículo. Não na corrente sanguínea (que seria perigoso) — só localmente.

Tem uma cápsula que combina essa fórmula. 3 cápsulas ao dia, 90 dias de uso. Estudos mostram redução de 62% na queda em casos leves a moderados.

Não vai fazer cabelo nascer onde já calvo. Em quem tá afinando — segura.

Aperta. Vê se serve.`,
    whyItWorks: 'Elimina causas folclóricas, ensina mecanismo (DHT), nomeia tratamento padrão sem demonizar (Minoxidil), oferece alternativa com prova científica, é HONESTA sobre limite ("não nasce onde já calvo").',
  },

  // ─── PRODUTO FÍSICO / LIFESTYLE ─────────────────────────────────
  {
    id: 'fisico_pt_1',
    vertical: 'fisico',
    awareness: '4',
    angle: 'Especificidade do problema',
    language: 'pt',
    script: `Tua cervical trava quando você levanta da escrivaninha. Eu sei porque a minha também travava.

Cervical não trava por idade. Trava porque o teu monitor tá baixo demais e teu pescoço passa 8 horas inclinado pra frente — postura chamada "tech neck".

A musculatura suboccipital encurta. Quando você levanta de uma vez, ela puxa a vértebra C1 e dá aquele estalo seguido de dor que dura três dias.

Tem um aparelho chinês chamado "neck cradle" que distende essa musculatura em 10 minutos. Você deita, encosta a nuca, ele faz tração natural usando o peso da cabeça. Sem motor, sem bateria.

Custa 89 reais no Mercado Livre. Eu uso 4 vezes por semana, há um ano. Não tenho mais o estalo de domingo de manhã.

Não cura artrose. Não substitui fisioterapia. Mas pra 80% dos casos comuns de "tech neck", resolve.

Link aqui.`,
    whyItWorks: 'História pessoal verossímil ("eu sei porque a minha também"), nome técnico que dá credibilidade ("suboccipital", "vértebra C1"), preço específico, autohonestidade ("não cura artrose"), CTA limpo.',
  },

  // ─── ESPIRITUAL / AUTOCONHECIMENTO ──────────────────────────────
  {
    id: 'esp_pt_1',
    vertical: 'espiritual',
    awareness: '2',
    angle: 'Identificação',
    language: 'pt',
    script: `Você tem aquela sensação de que tá esquecendo algo importante. Desde sempre.

Não é TDAH. Não é ansiedade. Não é falta de organização.

É o teu Mapa de Vida — o desenho astrológico que mostra teu propósito real desta vida — gritando que você tá no caminho errado.

83% das pessoas que vêm me consultar têm um Sol em desarmonia com a Casa 10. Isso significa: você nasceu pra exercer uma função que NÃO é a que você tá exercendo hoje. Por isso o cansaço sem motivo. Por isso aquele incômodo na segunda de manhã que nenhum café cura.

Eu sou astróloga há 22 anos, formada em três escolas internacionais. Faço um mapeamento completo em vídeo de 47 minutos onde eu te mostro EXATAMENTE em que ponto você desviou do teu caminho — e quando.

Não é horóscopo de revista. É um diagnóstico astrológico técnico.

Tá em promoção essa semana, R$ 197. Link abaixo.`,
    whyItWorks: 'Nomeia uma sensação universal mas vaga ("esquecendo algo importante"), exclui diagnósticos alternativos pra reforçar o oferecido, número específico ("83%", "Casa 10"), credibilidade da autora (22 anos, 3 escolas), distingue de astrologia "rasa" (não horóscopo de revista).',
  },
];

// ════════════════════════════════════════════════════════════════════
// EN (9 exemplos)
// ════════════════════════════════════════════════════════════════════

const EN: CopyExample[] = [
  // ─── HEALTH / SUPPLEMENTS ───────────────────────────────────────
  {
    id: 'saude_en_1',
    vertical: 'saude',
    awareness: '2',
    angle: 'Diagnosis reframe',
    language: 'en',
    script: `That burning in your feet at 3 a.m. isn't aging.

It's a molecule called palmitoylethanolamide that your body stops producing after 50. Without it, nerve endings sit exposed — any pressure becomes fire.

Doctors hand out anti-convulsants to mute the signal. Muting isn't fixing. The fire returns by 3 a.m. the next night. Every night.

A capsule manufactured in Germany delivers that exact molecule back into circulation. In three weeks, 12,000+ people stopped waking up gripping their feet.

You won't see this on TV. Big Pharma doesn't allow it.

Tap below. Watch the testimonial. See if it sounds familiar.`,
    whyItWorks: 'Specific sensory opening (3am, feet), diagnosis reframe ("not aging — molecule"), explains mechanism plausibly, social proof number, conspiracy lite at end (works in DR), soft CTA.',
  },
  {
    id: 'saude_en_2',
    vertical: 'saude',
    awareness: '4',
    angle: 'Tried-everything story',
    language: 'en',
    script: `I tried six things for my anxiety. Maybe you tried five.

Xanax made me a zombie. Lexapro killed my libido. Acupuncture worked for two weeks. Meditation couldn't hold when Sunday night panic hit. CBD from the corner store? Too diluted to do anything.

What worked was Ashwagandha KSM-66 at 600mg twice daily. It's not a cure. It's an adaptogen that regulates cortisol. Three months in, I respond to stress differently.

Same compound, same dose, sits inside a capsule called [product]. Bought one bottle to test. I'm on bottle five now.

If you've tried everything, take a look. Costs less than three therapy sessions. Worked for me — might work for you.`,
    whyItWorks: 'First-person testimony, specific list with concrete objection per item, technical naming gives credibility, financial comparison, honest CTA without hard promise.',
  },

  // ─── WEIGHT LOSS ────────────────────────────────────────────────
  {
    id: 'emag_en_1',
    vertical: 'emagrecimento',
    awareness: '3',
    angle: 'Paradigm shift',
    language: 'en',
    script: `Cutting carbs won't make you lose weight. It'll make you miserable and 6 lbs heavier in 4 months.

The truth nobody sells: belly fat isn't about calories. It's about cortisol.

Cortisol is the hormone your body dumps when stressed. Work, traffic, kids, bills. High cortisol tells your body to store fat in your midsection — to "survive the famine coming."

You can eat salad and run 5 miles every day. If cortisol is sky-high, the belly stays.

Three things actually lower cortisol: ashwagandha, real sleep (not 6 hours), and not cutting carbs.

A capsule out of Boulder combines ashwagandha with inositol and magnesium. People take it, sleep deep, and the belly deflates in two weeks.

Link below. No miracle promised. Just sleep.`,
    whyItWorks: 'Counterintuitive lead, explains cortisol mechanism, validates effort, promises modest outcome (sleep, not weight loss directly), specific geography (Boulder = wellness aesthetic).',
  },

  // ─── FINANCE ────────────────────────────────────────────────────
  {
    id: 'fin_en_1',
    vertical: 'financas',
    awareness: '2',
    angle: 'Identification with pain',
    language: 'en',
    script: `You opened your banking app this morning and felt that little tightening in your chest.

Paycheck hit Friday. Today is Wednesday. Half of it gone.

Rent, utilities, groceries, daycare, car note, insurance. You work to pay bills. Pay bills to work.

It's not lack of a budget. You've tried YNAB. You canceled Netflix. You picked up DoorDash on weekends.

The problem is structural: your income is tied to your hours. And hours in a day are finite.

There's a model called "digital asset" — you create something once and sell it a thousand times. Template, course, audiobook, planning system, framework.

A step-by-step structure exists for starting from zero — no audience, no investment, 90 days to first sale. Costs less than dinner out.

Link below. Won't change your life in 7 days. 90 days, maybe.`,
    whyItWorks: 'Universal opener (banking app), concrete bills list, validates prior attempts (YNAB, Netflix, DoorDash), introduces conceptual frame, modest 90-day promise.',
  },

  // ─── INFO PRODUCT ───────────────────────────────────────────────
  {
    id: 'info_en_1',
    vertical: 'info_produto',
    awareness: '4',
    angle: 'Authority + insight',
    language: 'en',
    script: `I got fired three times before I turned 30. Thought I was unlucky.

Today I coach 47 people who do 6-figure months selling knowledge online. There's one thing ALL of them learned from me in week one — and it changed everything:

You don't sell courses. You sell transformations.

"Excel course" doesn't sell. "How to add $3,000/month using a spreadsheet your boss doesn't know exists" — that sells daily.

The difference isn't the content. It's the positioning.

I put together a free 47-minute training where I unpack this shift using 9 real student examples. By the end, you understand WHY your previous launches didn't sell.

It's free. No pitch in the middle. Pure content.

People who finish usually join the next cohort. People who join the cohort hit numbers. But that's a separate conversation.

Tap the link. See you inside.`,
    whyItWorks: 'Vulnerability ("fired three times"), specific number, teachable insight (transformations vs courses), free funnel entry, confident but not pushy CTA.',
  },

  // ─── BEAUTY ─────────────────────────────────────────────────────
  {
    id: 'beleza_en_1',
    vertical: 'beleza',
    awareness: '2',
    angle: 'Identification + reframe',
    language: 'en',
    script: `That forehead line showed up overnight at 38.

Wednesday night you didn't have it. Monday morning, there it was. No warning.

Your derm would offer Botox at $400, three times a year, for life. Do that math against your remaining years.

There's a molecule called Argireline. It's a peptide that does what Botox does — relaxes the muscle that wrinkles — except it comes in a cream and uses no needle. Applied nightly, 30 days softens the line 47%, per a University of Barcelona study.

A serum out of the UK combines Argireline with encapsulated retinol. Not the cheap kind. But it's equivalent to two Botox appointments a year, total.

Won't erase the line in a week. In three months, you stop thinking about it.

Link in bio.`,
    whyItWorks: 'Specific moment opener, financial reframe (Botox over years), introduces alternative with university citation, modest 3-month promise.',
  },

  // ─── PHYSICAL / LIFESTYLE ───────────────────────────────────────
  {
    id: 'fisico_en_1',
    vertical: 'fisico',
    awareness: '3',
    angle: 'Problem specificity',
    language: 'en',
    script: `Your neck locks up when you stand up from your desk. I know because mine did too.

Necks don't lock from age. They lock because your monitor sits too low and you spend 8 hours leaning forward — posture called "tech neck."

The suboccipital muscles shorten. When you stand up fast, they pull on the C1 vertebra and produce that grinding pop followed by a 3-day headache.

There's a device called a "neck cradle." You lie on it for 10 minutes, your skull rests on it, the weight of your head creates natural traction. No motor, no battery.

$29 on Amazon. I use it four times a week, for a year now. The Sunday morning grind is gone.

Doesn't cure arthritis. Doesn't replace physical therapy. For 80% of normal "tech neck" — solves it.

Link below.`,
    whyItWorks: 'Personal-experience opener, debunks age myth, technical anatomy gives credibility, specific price + frequency, honest scope limitation, simple CTA.',
  },

  // ─── ESPIRITUAL ─────────────────────────────────────────────────
  {
    id: 'esp_en_1',
    vertical: 'espiritual',
    awareness: '2',
    angle: 'Universal feeling reframe',
    language: 'en',
    script: `You have that feeling that you're forgetting something important. You've had it for years.

It's not ADHD. It's not anxiety. It's not poor organization.

It's your Life Chart — the astrological blueprint that shows your real purpose this lifetime — telling you you're on the wrong path.

83% of people who book a session with me have a Sun in disharmony with their Tenth House. Translation: you were born to perform a function that ISN'T the one you're performing now. That's why you feel tired without reason. That's why Monday morning hits like that.

I've been a practicing astrologer for 22 years, trained at three international schools. I do a complete 47-minute video mapping where I show you EXACTLY when and where you stepped off your path.

This isn't horoscope-magazine astrology. It's technical chart analysis.

On promo this week, $47. Link below.`,
    whyItWorks: 'Names a vague universal feeling, excludes alternative diagnoses to reinforce offered one, specific astrological terminology, credentials, distances from cheap astrology.',
  },

  // ─── HEALTH alt ─────────────────────────────────────────────────
  {
    id: 'saude_en_3',
    vertical: 'saude',
    awareness: '5',
    angle: 'Urgency / scarcity (real)',
    language: 'en',
    script: `If you've been waiting on the [product] bundle restock — it's back. 482 units. Last batch sold in 38 hours.

The new formula adds magnesium glycinate at 300mg (was 150) and removes the proprietary blend in favor of full transparency dosing on every label.

If you're on capsule three or four of your current bottle, order today. The next batch ships from Switzerland and won't land until late next month.

3 bottles ships free. 6 bottles drops to $24 each.

Link in bio.`,
    whyItWorks: 'Real scarcity (existing buyers, restock), formula improvement detail, transparency angle (no prop blend), specific shipping origin and timing, kit-economy pricing.',
  },
];

export const COPY_LIBRARY: CopyExample[] = [...PT_BR, ...EN];

// ────────────────────────────────────────────────────────────────────
// SELEÇÃO INTELIGENTE — qual exemplo entra no prompt
// ────────────────────────────────────────────────────────────────────

interface SelectionInput {
  /** Idioma do anúncio em geração ('pt' inclui PT-BR, 'en' inclui EN-US). */
  language: 'pt' | 'en';
  /** Inferida do brief/persona/productInfo. Optional — se ausente, pega
   *  qualquer vertical (pegando preferencialmente os mesmos awareness). */
  vertical?: CopyVertical;
  /** Nível de consciência alvo. Used como tiebreaker. */
  awareness?: AwarenessLevel;
  /** Ângulo do brief — used pra match fuzzy. */
  angleHint?: string;
  /** Quantos exemplos retornar (default 2). 2-3 é o sweet spot. */
  count?: number;
  /** Exemplos do cliente (UX18 — biblioteca pessoal). Quando presente,
   *  esses entram com prioridade ANTES do sistema. */
  clientLibrary?: CopyExample[];
}

/** Heurística leve pra mapear vertical baseado em productInfo. */
export function inferVertical(productInfo: any): CopyVertical | undefined {
  if (!productInfo) return undefined;
  const text = [
    productInfo.produto,
    productInfo.oferta,
    productInfo.dorPrincipal,
    productInfo.productName,
    productInfo.audience,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (
    /(suplement|cápsula|capsule|dor|sono|ansiedade|saúde|vitamin|colágeno|magnésio)/.test(text)
  )
    return 'saude';
  if (/(emagre|peso|gordur|low.?carb|diet|kg|quilos|barriga|cintura|abdom)/.test(text))
    return 'emagrecimento';
  if (
    /(invest|trading|renda extra|dropshipping|ação|cripto|finança|dinheiro|salário|side hustle)/.test(
      text,
    )
  )
    return 'financas';
  if (/(curso|mentoria|workshop|treinamento|aula|método|fórmula|community|membership)/.test(text))
    return 'info_produto';
  if (/(skincare|creme|sérum|antiaging|anti.?aging|cabelo|botox|ruga|colágeno)/.test(text))
    return 'beleza';
  if (/(tarot|mapa astral|astrolog|oração|reza|espírito|chacra|cristal|terapia)/.test(text))
    return 'espiritual';
  // Fallback genérico
  return 'fisico';
}

/** Retorna até `count` exemplos relevantes pro prompt. Prioridade:
 *  1) Cliente library da mesma vertical (até count)
 *  2) Cliente library de OUTRAS verticais (preenche resto)
 *  3) Sistema library da mesma vertical
 *  4) Sistema library de outras verticais (preenche resto)
 */
export function selectCopyExamples(input: SelectionInput): CopyExample[] {
  const { language, vertical, awareness, count = 2, clientLibrary = [] } = input;

  const langMatches = (e: CopyExample) => e.language === language;
  const sortByRelevance = (a: CopyExample, b: CopyExample) => {
    // Same vertical wins
    const aV = vertical && a.vertical === vertical ? 1 : 0;
    const bV = vertical && b.vertical === vertical ? 1 : 0;
    if (aV !== bV) return bV - aV;
    // Same awareness wins
    if (awareness) {
      const aA = a.awareness === awareness ? 1 : 0;
      const bA = b.awareness === awareness ? 1 : 0;
      if (aA !== bA) return bA - aA;
    }
    return 0;
  };

  const clientFiltered = clientLibrary.filter(langMatches).sort(sortByRelevance);
  const systemFiltered = COPY_LIBRARY.filter(langMatches).sort(sortByRelevance);

  // Concatena cliente primeiro, sistema depois. Dedupa por id.
  const seen = new Set<string>();
  const result: CopyExample[] = [];
  for (const e of [...clientFiltered, ...systemFiltered]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    result.push(e);
    if (result.length >= count) break;
  }
  return result;
}
