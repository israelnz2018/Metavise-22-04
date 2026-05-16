import { GoogleGenAI } from "@google/genai";

const getAI = (apiKey?: string) => {
  const key = apiKey || (typeof process !== 'undefined' ? (process.env.GEMINI_API_KEY || (process.env as any).API_KEY) : undefined);
  if (!key) {
    throw new Error("Gemini API Key não encontrada nas variáveis de ambiente. Verifique o menu de configurações.");
  }
  return new GoogleGenAI({ apiKey: key });
};

export const getTiposHookPorNivel = (nivelConsciencia: string): string[] => {
  const level = nivelConsciencia.toString().charAt(0);
  switch (level) {
    case '1': return ['Surpresa', 'Curiosidade', 'Identificação'];
    case '2': return ['Identificação', 'Confissão', 'Quebra de Paradigma'];
    case '3': return ['Quebra de Paradigma', 'Contraste', 'Resultado'];
    case '4': return ['Resultado', 'Contraste', 'Surpresa'];
    case '5': return ['Resultado', 'Urgência/Notícia', 'Humor'];
    default: return ['Resultado', 'Curiosidade', 'Identificação'];
  }
};

export const generateHooks = async (answers: Record<string, any>, apiKey?: string) => {
  const ai = getAI(apiKey);
  const nivel = (answers.awarenessLevel || '3').toString();
  const tipos = getTiposHookPorNivel(nivel);
  
  const prompt = `
    DADOS DO PROJETO:
    - Persona/Público: ${answers.audience || 'Não informado'}
    - Idade: ${answers.age || 'Não informado'}
    - Situação Atual: ${answers.currentSituation || 'Não informado'}
    - Problema Principal: ${answers.painPoints || 'Não informado'}
    - O que já tentou: ${answers.triedBefore || 'Não informado'}
    - Nível de Consciência: ${nivel}
    - Estilo do Anúncio: ${answers.estiloAnuncio || 'Não informado'}
    - Produto: ${answers.productName || 'Não informado'}
    - Problema que resolve: ${answers.problemSolved || 'Não informado'}
    - Resultado concreto: ${answers.concreteResult || 'Não informado'}
    - Mecanismo único: ${answers.uniqueMechanism || 'Não informado'}
    - Prova Social: ${answers.socialProof || 'Não informado (NÃO INVENTE DADOS)'}
    - Tipo de Oferta: ${answers.businessModel || 'Não informado'}
    - Emoção Principal: ${answers.emotion || 'Não informado'}
    - Ângulo da Copy: ${answers.copyAngle || 'Não informado'}

    ---

    VOCÊ É:
    Um copywriter sênior de performance marketing, especialista em anúncios para Meta (Facebook/Instagram), focado em conversão e princípios de Eugene Schwartz e Robert Cialdini.

    ANÁLISE INTERNA DO AVATAR:
    Analise mentalmente quem é essa pessoa, suas pressões reais e vocabulário natural. Use isso para criar hooks autênticos.

    REGRAS ABSOLUTAS:
    - JAMAIS invente prova social, números, nomes de empresas ou depoimentos.
    - Se a Prova Social estiver vazia, foque em outros ângulos.
    - Se o Tipo de Oferta for "Plataforma com acesso contínuo", NÃO use gatilhos de "vagas fechando".
    - Use linguagem natural, evite "Imagine entregar..." ou tons formais de e-mail.
    - OBRIGATÓRIO: cada hook DEVE conter pelo menos UM termo específico do nicho do avatar extraído dos campos preenchidos pelo usuário (ex: 'Minitab', 'Black Belt', 'Lean Six Sigma', 'projetos de redução de custos'). Hooks genéricos como 'complexidade técnica' ou 'ferramentas' são PROIBIDOS — use os termos exatos do nicho que o usuário forneceu nos campos Produto, Mecanismo Único e Problema Principal.
    - PROIBIDO inventar motivações, desejos ou benefícios secundários do avatar que não foram explicitamente mencionados pelo usuário. Por exemplo, NÃO suponha que o avatar quer 'promoção', 'reconhecimento', 'liberdade financeira' ou qualquer outra motivação que não esteja nos campos preenchidos. Trabalhe APENAS com o que o usuário forneceu — não preencha lacunas com suposições.

    OBJETIVO:
    Gerar exatamente 3 hooks, cada um seguindo um destes tipos: ${tipos.join(', ')}.

    TIPOS DE HOOKS QUE VOCÊ CONHECE:
    1. Quebra de Paradigma — contraria crenças comuns.
    2. Surpresa / Choque — estatística ou afirmação chocante.
    3. Curiosidade / Pergunta — abre um loop mental.
    4. Resultado / Promessa — foca no benefício concreto.
    5. Identificação — espelha o público ("Se você é X...").
    6. Confissão / História — storytelling em primeira pessoa.
    7. Humor / Absurdo — tom leve e inesperado.
    8. Urgência / Notícia — novidade quente/urgente (apenas se honesto).
    9. Contraste / Antes-Depois — mostra a transformação.

    FORMATO DE SAÍDA EXATO (JSON):
    {
      "hooks": [
        { "tipo": "${tipos[0]}", "texto": "..." },
        { "tipo": "${tipos[1]}", "texto": "..." },
        { "tipo": "${tipos[2]}", "texto": "..." }
      ]
    }
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json"
    }
  });

  try {
    return JSON.parse(response.text);
  } catch (e) {
    console.error("Failed to parse hook response:", response.text);
    return { hooks: [] };
  }
};

export const chooseBestHooks = async (projectData: any, candidateHooks: any[], apiKey?: string) => {
  const ai = getAI(apiKey);
  
  const prompt = `
    DADOS DO PROJETO:
    - Produto: ${projectData.productName || 'Não informado'}
    - Avatar/Público: ${projectData.audience || 'Não informado'}
    - Emoção Principal: ${projectData.emotion || 'Não informado'}
    - Ângulo da Copy: ${projectData.copyAngle || 'Não informado'}
    - Nível de Consciência: ${projectData.awarenessLevel || '3'}

    CANDIDATOS (Estes são templates da nossa biblioteca):
    ${candidateHooks.map(h => `ID: ${h.id} | Tipo: ${h.tipo} | Template: ${h.template}`).join('\n')}

    OBJETIVO:
    Sua tarefa é selecionar os 9 melhores hooks entre os candidatos acima (3 de cada tipo solicitado).
    Os hooks devem ser escolhidos com base em quão bem o seu template se adapta ao contexto do projeto (avatar, emoção e ângulo).
    
    Para cada grupo de 3 hooks do mesmo tipo, marque UM como o "recomendado" (melhor de todos para aquele grupo).

    REGRAS:
    - Retorne APENAS o JSON conforme a estrutura abaixo.
    - Não altere os templates, apenas escolha seus IDs.

    FORMATO DE SAÍDA EXATO (JSON):
    {
      "grupos": [
        {
          "tipo": "Tipo do Grupo 1",
          "hooks": [
            { "id": ID_ESCOLHIDO_1, "recomendado": false },
            { "id": ID_ESCOLHIDO_2, "recomendado": true },
            { "id": ID_ESCOLHIDO_3, "recomendado": false }
          ]
        },
        ... (mais 2 grupos)
      ]
    }
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json"
    }
  });

  try {
    return JSON.parse(response.text);
  } catch (e) {
    console.error("Error choosing hooks:", e);
    return null;
  }
};

export const generateAdCopy = async (
  answers: Record<string, any>, 
  mode: 'improve' | 'as-is' | 'questions', 
  angle: string, 
  apiKey?: string, 
  scriptLength?: 'short' | 'medium' | 'long', 
  targetWordCount?: number,
  hookSelecionado?: string
) => {
  const ai = getAI(apiKey);
  
  if (mode === 'as-is') {
    return {
      script: `[HOOK]: ${hookSelecionado || ''}\n\n[AVATAR]: ${answers.existingCopy}`
    };
  }

  const currentLevel = (answers.awarenessLevel || '3').toString().charAt(0) || '3';
  const wordCount = targetWordCount || 150;

  // Estrutura de beats por Nível de Consciência (Eugene Schwartz)
  const beatStructures: Record<string, string> = {
    '1': `
ESTRUTURA DE BEATS PARA NÍVEL 1 (Inconsciente — não sabe que tem o problema):

[HOOK]: "${hookSelecionado}"
↓
[REVELAÇÃO] (~20% das palavras)
- Apresentar uma realidade que o avatar NÃO percebia
- Conectar com algo do dia a dia dele que ele não associava ao problema
- Tom: descoberta, não confronto

[EVIDÊNCIA] (~25% das palavras)
- Dado, estatística, estudo ou observação concreta que prova a revelação
- Algo que faz o avatar pensar "nossa, faz sentido"

[CONEXÃO COM PRODUTO] (~30% das palavras)
- Apresenta o produto como ferramenta que resolve algo que o avatar nem sabia que tinha
- Mecanismo único: ${answers.uniqueMechanism || '[mecanismo do produto]'}

[CTA SUAVE] (~10% das palavras)
- Convite para descobrir mais, sem pressão
- Ex: "Descubra como", "Veja por si mesmo"`,

    '2': `
ESTRUTURA DE BEATS PARA NÍVEL 2 (Consciente do Problema — sente a dor mas não sabe a causa):

[HOOK]: "${hookSelecionado}"
↓
[AGITAÇÃO DA DOR] (~25% das palavras)
- Aprofundar a dor com 2-3 detalhes específicos do dia a dia do avatar
- Usar linguagem do próprio avatar (não corporativa)
- Mostrar que entendemos exatamente o que ele sente

[DIAGNÓSTICO ÚNICO] (~20% das palavras)
- Reframar o problema: não é o que ele pensa que é
- "O problema não é X, é Y" (Y é o que o produto resolve)
- Ex: "Não é falta de inteligência, é falta de método"

[SOLUÇÃO + MECANISMO] (~30% das palavras)
- Apresentar o produto como a solução exata
- Explicar o mecanismo único: ${answers.uniqueMechanism || '[mecanismo do produto]'}
- Foco no "como" funciona, não em features

[PROVA] (~15% das palavras)
- Número, autoridade ou referência concreta
- Se não houver dados específicos, usar prova de mecanismo (ex: "baseado em [método]")

[CTA] (~10% das palavras)
- Direto mas não agressivo
- Foco no benefício imediato do clique
- Ex: "Comece agora", "Veja o método completo"`,

    '3': `
ESTRUTURA DE BEATS PARA NÍVEL 3 (Consciente da Solução — busca solução, comparando opções):

[HOOK]: "${hookSelecionado}"
↓
[QUEBRA DE PARADIGMA] (~20% das palavras)
- Contradiz uma crença comum sobre como resolver o problema
- Apresenta um insight contra-intuitivo
- "Você acha que precisa de X, mas na verdade..."

[MECANISMO ÚNICO] (~30% das palavras)
- Detalhar como o produto é diferente das alternativas
- Mecanismo: ${answers.uniqueMechanism || '[mecanismo do produto]'}
- Por que funciona quando outros métodos falham

[PROVA] (~25% das palavras)
- Resultado específico com número ou prazo
- Autoridade, certificação ou método comprovado
- Caso real (mesmo que genérico)

[CTA DIRETO] (~15% das palavras)
- Ação clara com benefício imediato
- Ex: "Garanta sua vaga", "Acesse o método"`,

    '4': `
ESTRUTURA DE BEATS PARA NÍVEL 4 (Consciente do Produto — compara você com concorrentes):

[HOOK]: "${hookSelecionado}"
↓
[DIFERENCIAÇÃO] (~30% das palavras)
- Por que o produto é diferente dos concorrentes
- 1-2 diferenciais específicos e tangíveis
- Não atacar concorrentes, mostrar singularidade

[PROVA SOCIAL] (~30% das palavras)
- Resultados de clientes (ou prova de mecanismo se não houver clientes)
- Números específicos
- Autoridade

[GARANTIA] (~20% das palavras)
- Reduzir o risco da decisão
- Garantia, suporte ou comprovação

[CTA + BENEFÍCIO] (~15% das palavras)
- CTA direto com benefício imediato
- Ex: "Comece hoje com [garantia]"`,

    '5': `
ESTRUTURA DE BEATS PARA NÍVEL 5 (Totalmente Consciente — pronto para comprar):

[HOOK + OFERTA]: "${hookSelecionado}"
↓
[OFERTA EXPANDIDA] (~30% das palavras)
- Detalhar a oferta concreta
- Preço, bônus, condições

[URGÊNCIA REAL] (~30% das palavras)
- Escassez ou prazo real (não fabricado)
- Razão concreta para agir agora

[CTA DIRETO] (~30% das palavras)
- Ação imediata
- Sem rodeios`
  };

  const prompt = `Você é um copywriter sênior especialista em Meta Ads e direct response, treinado nos princípios de Eugene Schwartz (Breakthrough Advertising).

CONTEXTO DO PROJETO:
━━━━━━━━━━━━━━━━━━━━━━
Idioma: ${answers.language || 'Português (Brasileiro)'}
Nível de Consciência: ${currentLevel}
Audiência: ${answers.audience || ''}
Dor principal: ${answers.situation || answers.painPoints || ''}
Produto: ${answers.productName || ''}
Resultado entregue: ${answers.productResult || ''}
Mecanismo único: ${answers.uniqueMechanism || ''}
Estilo do anúncio: ${answers.estiloAnuncio || 'Direto ao Ponto'}
Ângulo da copy: ${angle || 'Direto'}
Emoção principal: ${answers.primaryEmotion || ''}
Destino do clique: ${answers.clickDestination || 'Vídeo'}
Tipo de oferta: ${answers.businessModel || ''}
━━━━━━━━━━━━━━━━━━━━━━

HOOK SELECIONADO PELO USUÁRIO (USE COMO PRIMEIRA LINHA, EXATAMENTE COMO ESTÁ):
"${hookSelecionado}"

${beatStructures[currentLevel] || beatStructures['3']}

REGRAS DE OURO (VIOLAÇÃO = COPY INVÁLIDA):

═══════════════════════════════════════════════════════════
🚫 LISTA NEGRA — PALAVRAS/FRASES PROIBIDAS:
═══════════════════════════════════════════════════════════
NUNCA use estas palavras/frases (são gatilhos de invenção):
- "thousands", "millions", "everyone is", "many people"
- "milhares", "milhões", "todo mundo", "muitas pessoas"
- "studies show", "research proves", "scientifically proven"
- "estudos mostram", "pesquisas provam", "cientificamente comprovado"
- "doctors recommend", "experts agree", "trending podcast"
- "médicos recomendam", "especialistas concordam", "podcast em alta"
- "exactly X days", "X% guaranteed", "in just X minutes"
- "exatamente X dias", "X% garantido", "em apenas X minutos"
- "viral", "world-famous", "best-selling"
- "famoso mundialmente", "mais vendido"

ÚNICA EXCEÇÃO: se o número, fonte ou frase EXATA estiver nos campos do projeto fornecidos, pode usar. Caso contrário, PROIBIDO.

═══════════════════════════════════════════════════════════
🚫 INVENÇÃO PROIBIDA:
═══════════════════════════════════════════════════════════
- NÃO criar personagens fictícios ("uma professora aposentada", "um cliente disse")
- NÃO inventar depoimentos, citações ou histórias
- NÃO citar fontes específicas (nomes de podcasts, jornais, médicos) que NÃO foram fornecidas
- NÃO inventar prazos, percentuais ou estatísticas
- NÃO criar instituições, certificações ou prêmios

Se o usuário forneceu fonte vaga (ex: "podcast"), MANTENHA a vagueza — não preencha com detalhes fictícios.

═══════════════════════════════════════════════════════════
✅ REFINAMENTO PERMITIDO (e encorajado):
═══════════════════════════════════════════════════════════
Quando o usuário fornece termo vago/genérico, VOCÊ DEVE refinar:

❌ Vago: "natural" → ✅ Refinado: "à base de plantas medicinais"
❌ Vago: "efficient" → ✅ Refinado: "ação rápida nos primeiros dias"
❌ Vago: "powerful" → ✅ Refinado: termo específico ao mecanismo
❌ Vago: "innovative" → ✅ Refinado: descrição do que é novo
❌ Vago: "complete solution" → ✅ Refinado: 2-3 componentes específicos

REGRA: refine para ser MAIS específico, MAS apenas com base em informação real do projeto. Não invente dados novos.

═══════════════════════════════════════════════════════════
🔬 MECANISMO ÚNICO — REGRAS:
═══════════════════════════════════════════════════════════
- DEVE explicar COMO funciona (não só QUE funciona)
- DEVE diferenciar de alternativas (por que isso e não X)
- PROIBIDO adjetivos vazios: "potente", "eficaz", "poderoso", "natural", "completo"
- Use ingredientes/componentes/etapas se fornecidos pelo usuário
- Se o usuário forneceu mecanismo vago, refine para descrição mais específica do FUNCIONAMENTO (não dos benefícios)

═══════════════════════════════════════════════════════════
🎯 CTA — VALIDAÇÃO POR DESTINO DO CLIQUE:
═══════════════════════════════════════════════════════════
ATENÇÃO: clickDestination atual = "${answers.clickDestination || 'Vídeo'}"

Use EXATAMENTE o tipo de CTA correspondente:
→ "Vídeo" → CTA do tipo: "Veja como funciona", "Assista o vídeo completo agora"
→ "Landing Page de Vendas" → CTA do tipo: "Garanta sua vaga", "Comece hoje"
→ "Lead Form" → CTA do tipo: "Cadastre-se gratuitamente", "Inscreva-se agora"
→ "WhatsApp" → CTA do tipo: "Fale com nosso time no WhatsApp", "Chame no Whats"
→ "Página de Captura" → CTA do tipo: "Receba o material", "Baixe agora"

PROIBIDO escrever CTA que não corresponda ao destino real fornecido.

═══════════════════════════════════════════════════════════
📐 ESTRUTURA E TAMANHO:
═══════════════════════════════════════════════════════════
1. HOOK: A primeira linha DEVE ser exatamente o hook fornecido. Não modificar.
2. ESTRUTURA: Seguir RIGIDAMENTE a estrutura de beats acima.
3. TAGS visíveis: cada beat com sua tag em [COLCHETES].
4. TAMANHO: Total = ${wordCount} palavras (±10%).

═══════════════════════════════════════════════════════════
🚫 ANTI-REPETIÇÃO:
═══════════════════════════════════════════════════════════
- Nome do produto: máximo 2 menções na copy inteira
- Termo central da dor: máximo 3 menções, usar sinônimos
- Cada beat tem conteúdo único, não repetir o mesmo argumento

═══════════════════════════════════════════════════════════
🎨 ESTILO "${answers.estiloAnuncio || 'Direto ao Ponto'}":
═══════════════════════════════════════════════════════════
Manter o tom desse estilo em todos os beats sem perder a estrutura.

═══════════════════════════════════════════════════════════
🛡️ AUTO-VERIFICAÇÃO ANTES DE RESPONDER:
═══════════════════════════════════════════════════════════
Antes de retornar o JSON, REVISE sua copy e verifique:
1. ☐ Existe algum número/dado/prazo que NÃO foi fornecido pelo usuário? Se sim, REMOVER.
2. ☐ Existe algum personagem/depoimento fictício? Se sim, REMOVER.
3. ☐ Existe alguma palavra da LISTA NEGRA? Se sim, SUBSTITUIR.
4. ☐ O CTA corresponde ao destino "${answers.clickDestination || 'Vídeo'}"? Se não, AJUSTAR.
5. ☐ O mecanismo único usa adjetivos vagos? Se sim, REFINAR para descrição funcional.

Só retorne o JSON após passar nas 5 verificações.

FORMATO DA RESPOSTA:
Retorne em JSON com esta estrutura exata:
{
  "script": "Roteiro completo com tags de beats visíveis. Começar com [HOOK]: <hook exato>. Depois [BEAT_NOME]: <conteúdo do beat>. Cada beat em uma linha separada com quebra dupla."
}

Exemplo de formato esperado:
[HOOK]: Pare de rolar se você sofre de insônia.

[AGITAÇÃO DA DOR]: <conteúdo>...

[DIAGNÓSTICO ÚNICO]: <conteúdo>...

[SOLUÇÃO + MECANISMO]: <conteúdo>...

[PROVA]: <conteúdo>...

[CTA]: <conteúdo>...`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json"
    }
  });

  try {
    const parsed = JSON.parse(response.text);
    return {
      hooks: [], // mantém compatibilidade — hooks já vêm do hookSelecionado
      script: parsed.script
    };
  } catch (e) {
    console.error("Failed to parse AI response as JSON:", response.text);
    return {
      hooks: [],
      script: response.text
    };
  }
};

export const optimizeCopyForElevenLabs = async (originalCopy: string, answers: Record<string, any>, apiKey?: string) => {
  const ai = getAI(apiKey);
  
  const estilo = answers.estiloAnuncio || 'Direto ao Ponto';
  const emocao = answers.emotion || 'Frustração';
  
  const prompt = `
    Você é um especialista em Sound Design e Narrativas de Voz para anúncios em vídeo.
    Sua missão é converter o roteiro abaixo em uma versão otimizada exclusivamente para a tecnologia ELEVENLABS V3.

    ---
    REGRAS DE OURO PARA ELEVENLABS V3:

    1. REMOÇÃO DE DIREÇÕES (CRÍTICO):
       Remova TODAS as direções de palco em parênteses. NADA como (suspira), (pausa), (fala animado) deve ficar no texto. ElevenLabs lê isso como texto.

    2. TRANSFORMAÇÃO PARA TAGS V3:
       Substitua as direções e emoções por tags v3 em colchetes COLOCADAS IMEDIATAMENTE ANTES da frase afetada.
       Tags permitidas:
       - Emoções: [curious], [excited], [sad], [angry], [crying], [mischievously], [nervously], [cheerful], [annoyed]
       - Entrega: [whispers], [shouts], [softly], [gently], [slowly], [thoughtfully]
       - Reações: [sighs], [laughs], [laughing], [gasps], [clears throat], [gulps], [exhales]
       - Combinações: [nervously][whispers], [excited][shouts]

    3. PAUSAS E RITMO:
       - Use " — " para pausas naturais e curtas no meio da frase.
       - Use "…" para hesitação ou suspense.
       - NÃO use tags <break> de SSML. Use dashes (—) ou pontuação para o ritmo.

    4. ÊNFASE:
       - Use LETRAS MAIÚSCULAS para palavras que precisam de stress emocional forte (ex: "Isso é INCRÍVEL").

    5. CONTEXTO E ESTILO (ESTILO SELECIONADO: ${estilo} | EMOÇÃO: ${emocao}):
       Aplique a lógica de direção baseada no contexto:
       - Alívio / Inspirador / Storytelling: use [sighs] em momentos de virada, [softly] para partes vulneráveis, [slowly] para frases de impacto.
       - Urgência / Escassez / Direto ao Ponto: use [excited], CAPITALS nas ofertas principais, e pausas curtas (—) antes do CTA.
       - Prova Social: use [thoughtfully], [sincerely] para depoimentos.
       - Humor / Entretenimento: use [laughing], [mischievously], [cheerful].
       - Problema → Solução: comece com [nervously] ou [sad] no problema, mude para [excited] ou [cheerful] na solução.
       - Gancho de Curiosidade: use [curious], "…" para suspense, e uma pausa após o gancho.
       - Antes e Depois: [slowly] e [sad] no "antes", [excited] e [cheerful] no "depois".

    6. REQUISITOS FINAIS:
       - Mantenha o idioma original do roteiro.
       - Não mude a copy, apenas otimize a entrega vocal.
       - Maximize o realismo humano.
       - O texto FINAL deve conter apenas o que deve ser lido pela IA (incluindo as tags em colchetes).

    ---
    ROTEIRO ORIGINAL:
    ${originalCopy}

    ---
    RETORNE APENAS O TEXTO OTIMIZADO:
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt
  });

  let optimized = response.text;
  
  // Post-processing cleanup to ensure no illegal tags remain
  optimized = optimized.replace(/\(.*?\)/g, '');
  
  return optimized.trim();
};

export const generateVoice = async (text: string, voiceId: string = 'kore', apiKey?: string, retries = 3, settings?: { stability?: number, speed?: number }) => {
  // Check if it's an ElevenLabs voice (heuristic: ElevenLabs IDs are typically 20 chars long)
  if (voiceId.length > 15) {
    if (!voiceId) throw new Error("ID da voz não selecionado ou inválido.");
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(`/api/elevenlabs/tts/${voiceId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            voice_settings: {
              stability: settings?.stability ?? 0.5,
              similarity_boost: 0.75,
            },
            // Some models support speed directly
            speed: settings?.speed ?? 1.0
          }),
        });

        if (!response.ok) {
          const contentType = response.headers.get("content-type");
          let errorData: any = {};
          if (contentType && contentType.includes("application/json")) {
            errorData = await response.json();
          } else {
            const text = await response.text();
            errorData = { message: text.substring(0, 100) };
          }
          const errorMessage = errorData.detail?.message || errorData.error?.message || errorData.message || errorData.error || JSON.stringify(errorData);
          
          // If rate limited or system busy, and we have retries left, wait and retry
          if ((response.status === 429 || errorMessage.includes("heavy traffic") || errorMessage.includes("system_busy")) && i < retries - 1) {
            console.warn(`[ElevenLabs] System busy (Attempt ${i + 1}/${retries}), retrying...`);
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1500));
            continue;
          }
          
          throw new Error(`ElevenLabs Error: ${errorMessage}`);
        }

        // Update credits in UI if header is present
        const remainingCredits = response.headers.get('x-remaining-credits');
        if (remainingCredits) {
          window.dispatchEvent(new CustomEvent('credits-updated', { detail: parseInt(remainingCredits) }));
        }

        const arrayBuffer = await response.arrayBuffer();
        const persistentUrl = response.headers.get('x-audio-url');
        
        return {
          arrayBuffer,
          persistentUrl
        };
      } catch (err) {
        console.error(`ElevenLabs TTS Attempt ${i + 1} failed:`, err);
        if (i === retries - 1) throw err;
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1500));
      }
    }
  }

  // Gemini TTS fallback
  const ai = getAI(apiKey);
  for (let i = 0; i < retries; i++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceId },
            },
          },
        },
      });

      const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!data) {
        console.warn("No audio data returned from Gemini TTS");
      }
      return {
        arrayBuffer: data,
        persistentUrl: null
      };
    } catch (err: any) {
      console.error(`Gemini TTS Attempt ${i + 1} failed:`, err);
      if (i === retries - 1) throw err;
      // Wait before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
};

export const generateVideo = async (prompt: string, apiKey?: string, aspectRatio: "16:9" | "9:16" | "1:1" = "9:16", imageBase64?: string | null) => {
  const ai = getAI(apiKey);
  
  const payload: any = {
    model: 'veo-3.1-lite-generate-preview',
    prompt,
    config: {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio
    }
  };

  if (imageBase64) {
    payload.image = {
      imageBytes: imageBase64.split(',')[1] || imageBase64,
      mimeType: 'image/png'
    };
  }

  let operation = await ai.models.generateVideos(payload);
  return operation;
};

export const checkVideoStatus = async (operation: any, apiKey?: string) => {
  if (!operation) {
    return { done: false, url: null, error: "Operação indefinida", state: 'ERROR' };
  }
  
  try {
    const ai = getAI(apiKey);
    
    // The SDK prefers receiving the full operation object back
    // Based on skill: ai.operations.getVideosOperation({ operation: operation })
    let result: any = null;
    let lastError: any = null;

    try {
      // Primary method for VEO as per skill
      if (ai.operations && typeof ai.operations.getVideosOperation === 'function') {
        result = await ai.operations.getVideosOperation({ operation });
      } else if (ai.models && typeof (ai.models as any).getVideosOperation === 'function') {
        result = await (ai.models as any).getVideosOperation({ operation });
      }
    } catch (e: any) {
      lastError = e;
    }

    // Fallback to general getOperation if getVideosOperation failed or wasn't found
    if (!result) {
      try {
        if (ai.operations && typeof (ai.operations as any).getOperation === 'function') {
          // getOperation typically takes the operation object directly
          result = await (ai.operations as any).getOperation(operation);
        }
      } catch (e: any) {
        lastError = e || lastError;
      }
    }

    if (!result) {
      // Final attempt: maybe it's a string ID and needs { name }
      const opName = typeof operation === 'string' ? operation : (operation.name || operation.id);
      if (opName) {
        try {
          if (ai.operations && typeof (ai.operations as any).getOperation === 'function') {
            result = await (ai.operations as any).getOperation({ name: opName });
          }
        } catch (e) {}
      }
    }

    if (!result) {
      throw lastError || new Error("Não foi possível verificar o status da operação.");
    }
    
    // 3. Normalize the response
    const videoUri = result.response?.video?.uri || 
                    result.response?.uri || 
                    result.url || 
                    result.video?.uri ||
                    result.response?.generatedVideos?.[0]?.video?.uri ||
                    null;

    const error = result.error ? (typeof result.error === 'object' ? result.error.message || JSON.stringify(result.error) : result.error) : null;

    return {
      done: !!result.done,
      url: videoUri,
      error: error,
      state: result.metadata?.state || result.state || (result.done ? 'COMPLETED' : 'PROCESSING')
    };
  } catch (err: any) {
    console.error("[Gemini API] Error checking video status:", err);
    return {
      done: false,
      url: null,
      error: (err.message && (err.message.includes("403") || err.message.includes("PERMISSION_DENIED"))) 
        ? "Acesso negado (403). A chave de API não tem permissão para acessar esta operação de vídeo." 
        : err.message || "Erro de servidor ao verificar status",
      state: 'ERROR'
    };
  }
};

export const translateToEnglish = async (text: string, aspectRatio: string, apiKey?: string) => {
  const ai = getAI(apiKey);
  const ratioDesc = aspectRatio === '1:1' ? 'SQUARE (1:1)' : aspectRatio === '9:16' ? 'VERTICAL (9:16)' : 'LANDSCAPE (16:9)';
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Translate the following video generation prompt from Portuguese to English for high-quality video generation. 
    CRITICAL: The video MUST be composed and optimized for a ${ratioDesc} aspect ratio. 
    Ensure the description emphasizes a composition that fits perfectly in a ${ratioDesc} frame.
    Keep it descriptive and detailed. Only return the translation.\n\nPrompt: ${text}`
  });
  return response.text;
};

export const generateVideoFromPrompt = async (prompt: string, aspectRatio: string = "9:16", apiKey?: string, modelId?: string) => {
  const apiKeyToUse = apiKey || (typeof process !== 'undefined' ? (process.env.GEMINI_API_KEY || (process.env as any).API_KEY) : undefined);
  const ai = getAI(apiKeyToUse);
  
  // Only translate if needed. Prompts from our new analysis are already in English.
  let finalPrompt = prompt?.trim() || "cinematic scene, high quality";
  if (finalPrompt.match(/[áéíóúçãõ]/i)) {
    console.log("[VEO] Prompt contains Portuguese characters, translating...");
    finalPrompt = await translateToEnglish(finalPrompt, aspectRatio, apiKey);
  } else {
    console.log("[VEO] Using direct English prompt:", finalPrompt);
  }

  // Final cleanup of the prompt to avoid common parsing issues
  finalPrompt = finalPrompt.replace(/```/g, '').trim();
  
  try {
    const response = await ai.models.generateVideos({
      model: modelId || "veo-3.1-lite-generate-preview", 
      prompt: finalPrompt,
      config: {
        // VEO only supports 16:9 and 9:16 according to documentation
        aspectRatio: (aspectRatio === "9:16" || aspectRatio === "16:9") 
          ? aspectRatio 
          : "9:16" as any,
      }
    });
    
    console.log("[Gemini API] Video generation initiated:", response.name || (response as any).id);
    return response;
  } catch (err: any) {
    const errorMessage = err.message || "";
    if (errorMessage.includes("429") || errorMessage.includes("quota") || errorMessage.includes("RESOURCE_EXHAUSTED")) {
      throw new Error("Limite de quota excedido no Gemini. Você atingiu o limite de gerações de vídeo permitidas para o seu plano no momento. Por favor, aguarde alguns minutos ou verifique seu faturamento em Google Cloud Console.");
    }
    if (errorMessage.includes("403") || errorMessage.includes("PERMISSION_DENIED")) {
      throw new Error("Acesso negado (403). Para gerar vídeos com VEO, você precisa selecionar uma chave de API própria (paga) do seu projeto Google Cloud no menu de configurações.");
    }
    throw err;
  }
};

export const getAuthorizedUrl = (url: string | null | undefined, apiKey?: string) => {
  if (!url) return null;
  
  let processedUrl = url;
  
  // Handle relative-looking paths from Google APIs
  if (processedUrl.startsWith('v1beta/')) {
    processedUrl = `https://generativelanguage.googleapis.com/${processedUrl}`;
  }

  // Safeguard: Do not authorize local paths, blobs, or non-http URLs
  if (processedUrl.startsWith('/generated') || processedUrl.startsWith('blob:') || !processedUrl.startsWith('http')) {
    return processedUrl;
  }
  
  try {
    const urlObj = new URL(processedUrl);
    if (urlObj.hostname.includes('generativelanguage.googleapis.com')) {
      // Strip common invalid suffixes
      urlObj.pathname = urlObj.pathname.replace(':download', '');

      // Try to get key from multiple possible sources
      let key = apiKey;
      if (!key) {
        const g = (window as any);
        
        // Priority: Process environment defines (from vite.config.ts)
        key = g.process?.env?.GEMINI_API_KEY || 
              g.process?.env?.API_KEY || 
              g.import?.meta?.env?.VITE_GEMINI_API_KEY ||
              (typeof process !== 'undefined' ? (process.env.GEMINI_API_KEY || (process.env as any).API_KEY) : undefined);
      }
      
      if (!key) {
        console.warn("[AI Video Debug] Missing API Key for authorization. URL:", url);
        return url;
      }
      
      // Force alt=media for binary download if not set
      if (!urlObj.searchParams.has('alt')) {
        urlObj.searchParams.set('alt', 'media');
      }
      urlObj.searchParams.set('key', key);
      
      const authorizedUrl = urlObj.toString();
      console.log("[AI Video Debug] Authorized Final URL:", authorizedUrl.replace(key, "REDACTED_KEY"));
      return authorizedUrl;
    }
  } catch (e) {
    console.warn("[AI Video Debug] URL parsing failed for:", url, e);
  }
  
  return url;
};

export const parseTechnicalEdit = async (prompt: string, apiKey?: string) => {
  const ai = getAI(apiKey);
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analise a seguinte instrução de edição de vídeo e extraia os parâmetros técnicos em formato JSON.
    Instrução: "${prompt}"
    
    Retorne APENAS o JSON com os seguintes campos (se presentes):
    - zoom: número (1.0 a 2.0, onde 1.0 é sem zoom)
    - textOverlay: string (texto a ser exibido)
    - textPosition: "top" | "center" | "bottom"
    - effect: string (nome do efeito, ex: "fade", "glitch")
    
    Exemplo: {"zoom": 1.2, "textOverlay": "Oferta Especial", "textPosition": "bottom"}`
  });
  
  try {
    const text = response.text.replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse technical edit JSON:", e);
    return {};
  }
};

export const generateEditingTimeline = async (script: string, duration?: number, apiKey?: string, level: 'low' | 'medium' | 'high' | 'very-low' = 'medium') => {
  const ai = getAI(apiKey);
  
  const intensityMap: Record<string, string> = {
    'very-low': 'Mínima: Apenas cortes básicos para limpeza, sem efeitos visuais adicionais.',
    'low': 'Baixa: Edição básica e limpa, com poucos cortes e zooms muito sutis.',
    'medium': 'Média: Edição equilibrada, sugerindo cortes e zooms quando necessário para manter o interesse.',
    'high': 'Alta: Edição dinâmica e agressiva, com muitos zooms, cortes frequentes e ritmo rápido para máximo impacto.'
  };

  const levelInstruction = intensityMap[level] || intensityMap['medium'];

  const prompt = `
    Você é um editor de vídeo especialista e profissional de marketing de performance.

    OBJETIVO:
    Criar um plano de edição intuitivo e engajador que inclua:
    - Edições básicas explicadas de forma clara (Corte, Zoom, Texto, Legenda)
    - Sugestões para gerar NOVOS CLIPES DE VÍDEO IA quando necessário
    - Separação entre uma EXPLICAÇÃO SIMPLES para o usuário entender o que será feito e o PROMPT DETALHADO que a IA usará.

    ---

    NÍVEL DE EDIÇÃO SOLICITADO:
    ${levelInstruction}

    ---

    REGRAS DE LINGUAGEM (SIMPLICIDADE COM EXPLICAÇÃO):
    - NÃO use apenas uma palavra ou termos técnicos vazios.
    - O texto para o usuário deve explicar O QUE vai acontecer e POR QUÊ, de forma direta.
    - Exemplos de como transformar termos técnicos em explicações simples:
      • Em vez de "Close-up", use "Aproximar o vídeo no rosto para dar ênfase à fala e criar conexão com quem assiste."
      • Em vez de "B-roll", use "Mostrar uma imagem ou vídeo que ilustre exatamente o que está sendo dito agora."
      • Em vez de "Fade", use "Fazer uma transição suave para mudar o clima da cena."
      • Em vez de "Zoom out", use "Afastar o vídeo para mostrar mais do ambiente e relaxar o ritmo."

    ---

    INSTRUÇÕES:

    1. Divida o roteiro em segmentos lógicos e LONGOS. Agrupe frases que tratam do mesmo assunto para manter a mesma edição por mais tempo. Evite picotar o vídeo desnecessariamente.
    2. O VÍDEO TEM UMA DURAÇÃO TOTAL DE ${duration ? `${duration.toFixed(1)} segundos` : 'tempo indeterminado'}. NÃO gere edições que ultrapassem este tempo total.
    3. PRECISÃO DE CORTE (CRÍTICO): O timestamp de início de cada segmento DEVE ser o momento exato em que a primeira palavra da "frase falada" começa. É terminantemente proibido cortar no meio de uma palavra. Garanta que o áudio da frase comece de forma limpa e completa no início do segmento.

    4. Para CADA segmento:
       - Identifique o que está sendo dito (mensagem central)
       - Identifique a emoção (dor, curiosidade, autoridade, alívio, etc.)
       - Decida o tipo de ação básica.

    5. REGRAS PARA VÍDEO IA:
       - Se sugerir um novo vídeo IA, ele deve ter PELO MENOS 4 segundos de duração para garantir qualidade visual.
       - Você deve fornecer uma descrição EXTREMAMENTE DETALHADA para o gerador de vídeo (VEO). Descreva: iluminação, enquadramento, cores, ação específica, expressão facial e ambiente.
       - OPÇÃO DE TELA DE TEXTO: Você também pode sugerir uma tela de fundo sólido (Fundo Preto com Letra Branca OU Fundo Branco com Letra Preta) como uma opção de "novo vídeo" para enfatizar frases de impacto.
       - REGRA DE TEMPO (CRÍTICO): A regra de "mínimo 4 segundos" aplica-se APENAS a novos vídeos IA. Para edições no vídeo original (cortes, zooms, textos), priorize intervalos que permitam ao usuário absorver a mensagem (ex: 3.5s, 5.0s, 2.8s). Evite edições menores que 2 segundos, a menos que seja um destaque curtíssimo.

    6. CRITÉRIO DE EDIÇÃO (MUITO IMPORTANTE):
       - FOQUE NA QUALIDADE E NÃO NA QUANTIDADE. Menos é mais.
       - Aumente o intervalo entre as edições. Evite micro-edições ou trocas visuais frenéticas.
       - Crie uma edição APENAS quando identificar uma oportunidade real de melhorar drasticamente o impacto visual ou a compreensão da mensagem.
       - Analise a COPY (roteiro) com extrema atenção: identifique os blocos de assunto. Mantenha a mesma edição por mais tempo se o assunto for o mesmo.
       - Se uma parte da copy não exigir mudança visual, mantenha a filmagem original por um período maior.

    7. REGRAS PARA O AVATAR (VÍDEO ORIGINAL):
       - O avatar no vídeo original tem um comportamento fixo e genérico.
       - NÃO presuma que o avatar fará gestos específicos (como apontar, sorrir em um momento exato ou mudar de postura).
       - Foque as instruções de edição do vídeo original em aspectos técnicos: níveis de zoom, sobreposição de texto, legendas dinâmicas e efeitos sonoros.
       - LEGENDAS PONTUAIS: Como uma legenda tradicional completa será configurada em uma etapa posterior, peça apenas legendas "pontuais" (destacando palavras ou frases específicas no centro da tela) para gerar impacto.
       - Use o zoom para criar dinamismo visual, já que o avatar é estático.

    8. Para CADA segmento, gere:
       - Intervalo de tempo (dentro do limite de ${duration ? duration.toFixed(1) : 'X'}s)
       - Frase exata falada (MÍNIMO DE 2 PALAVRAS - OBRIGATÓRIO)
       - Explicação Simples para o Usuário (ex: "Aproximar o vídeo no rosto para dar ênfase total à sua mensagem.")
       - Prompt Detalhado para a IA (dentro de colchetes [PROMPT: ...])

    ---

    FORMATO OBRIGATÓRIO (SIGA EXATAMENTE):

    00:00 – 00:01.5 | “frase curta” → Aproximar o vídeo no rosto para dar ênfase inicial e prender a atenção. [PROMPT: Zoom de 1.2x centralizado no rosto do avatar para criar conexão.]
    
    00:01.5 – 00:05.5 | “frase para vídeo novo” → Trocar para um novo clipe de IA que mostre uma pessoa reagindo à situação descrita. [PROMPT: Cinematic close-up de uma mulher de 30 anos com expressão de exaustão profunda, sentada em um escritório escuro iluminado pelo brilho azul de um monitor, fundo desfocado, 4k.]
    
    00:05.5 – 00:06.3 | “duas palavras” → Voltar para a visão original (plano médio) para estabilizar o ritmo do vídeo. [PROMPT: Retornar ao plano original do vídeo sem efeitos extras.]

    ---

    REGRAS PARA VÍDEO IA:
    - Sugira apenas quando melhorar a compreensão ou emoção
    - Sempre inclua: Duração (mínimo 4s) e Descrição visual COMPLETA (pessoa, emoção, ambiente, iluminação, estilo)
    - Deve ser realista e relevante para a frase

    ---

    REGRAS DE EDIÇÃO:
    - Priorize a COERÊNCIA com o texto acima de tudo.
    - FRASE FALADA (CRÍTICO): Cada segmento DEVE conter PELO MENOS 2 PALAVRAS. É TERMINANTEMENTE PROIBIDO usar apenas uma palavra (ex: "e", "a", "o", "mas", "que"), letras isoladas ou sílabas. Se a frase for curta, agrupe-a com a próxima para garantir o contexto.
    - Mude o visual APENAS quando o assunto ou a emoção da copy mudar de forma significativa.
    - PRIORIZE INTERVALOS LONGOS: Evite trocas visuais constantes. Deixe a cena "respirar".
    - Use zoom para dar ênfase em momentos cruciais da copy.
    - Mantenha o texto curto (máx. 5 palavras).
    - Evite efeitos que poluam a mensagem principal.

    ---

    IMPORTANTE:
    - NÃO use JSON
    - NÃO explique nada
    - APENAS forneça as linhas da linha do tempo
    - TUDO EM PORTUGUÊS
    - RESPEITE O LIMITE DE ${duration || 'X'} SEGUNDOS.

    ---

    ROTEIRO:
    ${script}
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt
  });

  return response.text;
};

export const generateTimelineFromVideo = async (videoBase64: string, script?: string, duration?: number, apiKey?: string, level: 'low' | 'medium' | 'high' | 'very-low' = 'medium') => {
  const ai = getAI(apiKey);
  
  const intensityMap: Record<string, string> = {
    'very-low': 'Mínima: Apenas cortes básicos para limpeza, sem efeitos visuais adicionais.',
    'low': 'Baixa: Edição básica e limpa, com poucos cortes e zooms muito sutis.',
    'medium': 'Média: Edição equilibrada, sugerindo cortes e zooms quando necessário para manter o interesse.',
    'high': 'Alta: Edição dinâmica e agressiva, com muitos zooms, cortes frequentes e ritmo rápido para máximo impacto.'
  };

  const levelInstruction = intensityMap[level] || intensityMap['medium'];

  const prompt = `
    Você é um editor de vídeo especialista e profissional de marketing de performance.

    OBJETIVO:
    Criar um plano de edição intuitivo e engajador que inclua:
    - Edições básicas explicadas de forma clara (Corte, Zoom, Texto, Legenda)
    - Sugestões para gerar NOVOS CLIPES DE VÍDEO IA quando necessário
    - Separação entre uma EXPLICAÇÃO SIMPLES para o usuário entender o que será feito e o PROMPT DETALHADO que a IA usará.

    ---

    NÍVEL DE EDIÇÃO SOLICITADO:
    ${levelInstruction}

    ---

    REGRAS DE LINGUAGEM (SIMPLICIDADE COM EXPLICAÇÃO):
    - NÃO use apenas uma palavra ou termos técnicos vazios.
    - O texto para o usuário deve explicar O QUE vai acontecer e POR QUÊ, de forma direta.
    - Exemplos de como transformar termos técnicos em explicações simples:
      • Em vez de "Close-up", use "Aproximar o vídeo no rosto para dar ênfase à fala e criar conexão com quem assiste."
      • Em vez de "B-roll", use "Mostrar uma imagem ou vídeo que ilustre exatamente o que está sendo dito agora."
      • Em vez de "Fade", use "Fazer uma transição suave para mudar o clima da cena."
      • Em vez de "Zoom out", use "Afastar o vídeo para mostrar mais do ambiente e relaxar o ritmo."

    ---

    INSTRUÇÕES:

    1. Analise o fluxo de fala e visual do vídeo. Divida em segmentos lógicos e LONGOS. Agrupe frases que tratam do mesmo assunto para manter a mesma edição por mais tempo. Evite picotar o vídeo desnecessariamente.
    2. O VÍDEO TEM UMA DURAÇÃO TOTAL DE ${duration ? `${duration.toFixed(1)} segundos` : 'tempo indeterminado'}. NÃO gere edições que ultrapassem este tempo total.
    3. PRECISÃO DE CORTE (CRÍTICO): O timestamp de início de cada segmento DEVE ser o momento exato em que a primeira palavra da "frase falada" começa. É terminantemente proibido cortar no meio de uma palavra. Garanta que o áudio da frase comece de forma limpa e completa no início do segmento.

    4. Para CADA segmento:
       - Identifique o que está sendo dito (transcreva se necessário)
       - Identifique a emoção (dor, curiosidade, autoridade, alívio, etc.)
       - Decida o tipo de ação básica.

    5. REGRAS PARA VÍDEO IA:
       - Se sugerir um novo vídeo IA, ele deve ter PELO MENOS 4 segundos de duração.
       - Você deve fornecer uma descrição EXTREMAMENTE DETALHADA para o gerador de vídeo (VEO). Descreva: iluminação, enquadramento, cores, action específica, expressão facial e ambiente.
       - OPÇÃO DE TELA DE TEXTO: Você também pode sugerir uma tela de fundo sólido (Fundo Preto com Letra Branca OU Fundo Branco com Letra Preta) como uma opção de "novo vídeo" para enfatizar frases de impacto.
       - REGRA DE TEMPO (CRÍTICO): A regra de "mínimo 4 segundos" aplica-se APENAS a novos vídeos IA. Para edições no vídeo original (cortes, zooms, textos), priorize intervalos que permitam ao usuário absorver a mensagem (ex: 3.5s, 5.0s, 2.8s). Evite edições menores que 2 segundos, a menos que seja um destaque curtíssimo.

    6. CRITÉRIO DE EDIÇÃO (MUITO IMPORTANTE):
       - FOQUE NA QUALIDADE E NÃO NA QUANTIDADE. Menos é mais.
       - Aumente o intervalo entre as edições. Evite micro-edições ou trocas visual frenéticas.
       - Crie uma edição APENAS quando identificar uma oportunidade real de melhorar drasticamente o impacto visual ou a compreensão da mensagem.
       - Analise a COPY (roteiro) com extrema atenção: identifique os blocos de assunto. Mantenha a mesma edição por mais tempo se o assunto for o mesmo.
       - Se uma parte da copy não exigir mudança visual, mantenha a filmagem original por um período maior.

    7. REGRAS PARA O AVATAR (VÍDEO ORIGINAL):
       - O avatar no vídeo original tem um comportamento fixo e genérico.
       - NÃO presuma que o avatar fará gestos específicos (como apontar, sorrir em um momento exato ou mudar de postura).
       - Foque as instruções de edição do vídeo original em aspectos técnicos: níveis de zoom, sobreposição de texto, legendas dinâmicas e efeitos sonoros.
       - LEGENDAS PONTUAIS: Como uma legenda tradicional completa será configurada em uma etapa posterior, peça apenas legendas "pontuais" (destacando palavras ou frases específicas no centro da tela) para gerar impacto.
       - Use o zoom para criar dinamismo visual, já que o avatar é estático.

    8. Para CADA segmento, gere:
       - Intervalo de tempo (dentro do limite de ${duration ? duration.toFixed(1) : 'X'}s)
       - Frase exata falada (MÍNIMO DE 2 PALAVRAS - OBRIGATÓRIO)
       - Explicação Simples para o Usuário (ex: "Aproximar o vídeo no rosto para dar ênfase total à sua mensagem.")
       - Prompt Detalhado para a IA (dentro de colchetes [PROMPT: ...])

    ---

    FORMATO OBRIGATÓRIO (SIGA EXATAMENTE):

    00:00 – 00:01.5 | “frase curta” → Aproximar o vídeo no rosto para dar ênfase inicial e prender a atenção. [PROMPT: Zoom de 1.2x centralizado no rosto do avatar para criar conexão.]
    
    00:01.5 – 00:05.5 | “frase para vídeo novo” → Trocar para um novo clipe de IA que mostre uma pessoa reagindo à situação descrita. [PROMPT: Cinematic close-up de uma mulher de 30 anos com expressão de exaustão profunda, sentada em um escritório escuro iluminado pelo brilho azul de um monitor, fundo desfocado, 4k.]
    
    00:05.5 – 00:06.3 | “duas palavras” → Voltar para a visão original (plano médio) para estabilizar o ritmo do vídeo. [PROMPT: Retornar ao plano original do vídeo sem efeitos extras.]

    ---

    REGRAS PARA VÍDEO IA:
    - Sugira apenas quando melhorar a compreensão ou emoção
    - Sempre inclua: Duração (mínimo 4s) e Descrição visual (pessoa, emoção, ambiente)
    - Deve ser realista e relevante para a frase

    ---

    REGRAS DE EDIÇÃO:
    - Priorize a COERÊNCIA com o texto.
    - FRASE FALADA (CRÍTICO): Cada segmento DEVE conter PELO MENOS 2 PALAVRAS. É TERMINANTEMENTE PROIBIDO usar apenas uma palavra (ex: "e", "a", "o", "mas", "que"), letras isoladas ou sílabas. Se a frase for curta, agrupe-a com a próxima para garantir o contexto.
    - Mude o visual APENAS quando a emoção ou o assunto da copy mudar de forma significativa.
    - PRIORIZE INTERVALOS LONGOS: Evite trocas visuais constantes. Deixe a cena "respirar".
    - Use zoom para dar ênfase em momentos cruciais.
    - Mantenha o texto curto (máx. 5 palavras).
    - Evite efeitos desnecessários.

    ---

    IMPORTANTE:
    - NÃO use JSON
    - NÃO explique nada
    - APENAS forneça as linhas da linha do tempo
    - TUDO EM PORTUGUÊS
    - RESPEITE O LIMITE DE ${duration || 'X'} SEGUNDOS.

    ${script ? `\n\nCONTEXTO (Roteiro/Transcrição):\n${script}` : ""}
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          {
            inlineData: {
              data: videoBase64,
              mimeType: "video/mp4"
            }
          },
          { text: prompt }
        ]
      }
    ]
  });

  return response.text;
};

export const generateVeoTimelineFromVideo = async (videoUrl: string, duration: number, apiKey?: string) => {
  const ai = getAI(apiKey);
  
  // Fetch the video for direct analysis
  let fileData: any = null;
  try {
    const response = await fetch(videoUrl);
    const blob = await response.blob();
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(blob);
    });
    fileData = {
      inlineData: {
        data: base64,
        mimeType: blob.type
      }
    };
  } catch (e) {
    console.error("Failed to fetch video for Gemini analysis:", e);
    throw new Error("Não foi possível carregar o vídeo para análise do Gemini.");
  }

  const prompt = `
    You are a master video editor and timestamp specialist. 
    TASK: Analyze the ATTACHED VIDEO and identify the exact moments to insert B-roll (secondary footage).
    
    CRITICAL INTELLIGENCE RULES:
    1. EXCLUSIVE VIDEO ANALYSIS: Do NOT use any external text. LISTEN to the audio and WATCH the video frames to identify what is being said and shown.
    2. SPEECH ALIGNMENT: Transcribe the spoken words at each moment. The [EXACT_PHRASE_SPOKEN] must be the literal words heard at that specific timestamp.
    3. TEMPORAL ACCURACY: PINPOINT the exact millisecond when a phrase begins. Use audio cues.
    4. NO HALLUCINATION: Only report what is actually in the video. If the video doesn't mention a specific topic, do NOT invent it (e.g., do NOT mention "intestino preso").
    
    TECHNICAL RULES:
    1. Each B-roll scene MUST be EXACTLY 4 seconds or 8 seconds long.
    2. Suggest between 2 and 5 B-roll moments depending on video length.
    3. Return ONLY lines in this exact format: [START_TIME]s | [DURATION]s | [VEO_PROMPT_IN_ENGLISH] | [EXACT_PHRASE_SPOKEN]
    4. CRITICAL: The START_TIME + DURATION must NEVER exceed the TOTAL DURATION of ${duration}s.
    
    VIDEO METADATA:
    - Total Duration: ${duration}s
    
    IMPORTANT:
    - The VEO_PROMPT_IN_ENGLISH must be highly detailed and ready to be sent to a video generation model.
    - Output format must be strict. Do not explain. Just output the lines.
  `;

  const contents = fileData 
    ? [ { role: 'user', parts: [fileData, { text: prompt }] } ]
    : [ { role: 'user', parts: [{ text: prompt }] } ];

  const result = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents
  });

  return result.text;
};

export const generateVideoPromptSuggestion = async (imageDescription: string, duration: number, apiKey?: string) => {
  const ai = getAI(apiKey);
  const prompt = `
    Based on the following visual concept for a video segment:
    "${imageDescription}"
    
    The segment duration is ${duration.toFixed(1)} seconds.
    
    TASK: Generate a technical, dynamic video generation prompt optimized for an AI video engine (like VEO or Runway). 
    The prompt should describe camera movement, action, and lighting that perfectly fits the ${duration.toFixed(1)}s timeframe.
    
    CRITICAL: 
    - The prompt MUST be in English.
    - Focus on motion and visual quality.
    - Only return the optimized prompt text. No explanations.
  `;
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt
  });
  
  return response.text;
};

export const generateImagePromptSuggestion = async (transcript: string, apiKey?: string) => {
  const ai = getAI(apiKey);
  const prompt = `
    Based on the following spoken transcript segment:
    "${transcript}"
    
    TASK: Generate a single, powerful visual "scene description" (Visual Briefing) that illustrates the literal or metaphorical meaning of this text.
    The description should be in Portuguese, concise but descriptive.
    
    EX: If the text is "Se você quer parar de ser mal orientada", the visual could be "Uma bússola quebrada em cima de um mapa antigo, com luz dramática."
    
    Only return the description text. No explanations.
  `;
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt
  });
  
  return response.text;
};

export const segmentVideoAndSuggestScenes = async (videoUrl: string, duration: number, apiKey?: string) => {
  const ai = getAI(apiKey);
  
  // Fetch video data for analysis
  let fileData: any = null;
  try {
    const response = await fetch(videoUrl);
    const blob = await response.blob();
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(blob);
    });
    fileData = {
      inlineData: {
        data: base64,
        mimeType: blob.type
      }
    };
  } catch (e) {
    console.error("Failed to fetch video for analysis:", e);
    throw new Error("Não foi possível carregar o vídeo para análise.");
  }

  const prompt = `
    You are a precision AI video editing assistant specializing in LOGICAL SEGMENTATION and TEMPORAL ALIGNMENT.
    
    TASK: Analyze the attached video and its script to create a "Visual Storyboard". 
    You must divide the video into segments based on the MEANING and PUNCTUATION of the spoken text.

    CRITICAL RULES FOR SEGMENTATION:
    1. PUNCTUATION MATTERS: A segment should IDEALLY start at the beginning of a full sentence or a major clause (after a comma or period).
    2. NO ARBITRARY CUTS: Do not cut in the middle of a word or a short phrase. Each segment must represent a complete logical idea.
    3. TRANSCRIPT PRECISION: The 'transcript' field for each segment MUST be the 100% literal words spoken during that exact time window.
    4. SUB-SECOND TIMING: Use the audio cues to find the EXACT millisecond a phrase starts and ends. 
    5. SELECTIVITY (THE STAR RULE):
       - The HUMAN AVATAR (original video) is the core.
       - "KEEP" (Avatar) should be the default for 70-80% of the video.
       - "REPLACE" (AI Video) should only be chosen for high-impact visual descriptions or metaphors.
       - DO NOT suggest replacing more than 2-3 segments in total unless the video is very long.

    OUTPUT FORMAT (STRICT JSON):
    Return ONLY a JSON array of objects:
    [
      {
        "number": 1,
        "type": "KEEP" | "REPLACE",
        "startTime": 0.0,
        "endTime": 4.5,
        "transcript": "Literal words spoken here...",
        "reason": "Why this cut is logical (e.g., 'End of intro sentence')",
        "visualConcept": {
          "sceneDescription": "Descriptive concept for the image (only if REPLACE)",
          "imagePrompt": "Detailed English image prompt (only if REPLACE)",
          "videoPrompt": "Cinematic English motion prompt (only if REPLACE)"
        }
      },
      ...
    ]
    
    METADATA:
    - Total Video Duration: ${duration}s.
    - Script Context: You must align with the provided script if available.

    CRITICAL constraints:
    - Ensure startTime of segment N is exactly endTime of segment N-1.
    - No gaps. Entire ${duration}s must be covered.
    - No explanations outside the JSON.
  `;

  const contents = [ { role: 'user', parts: [fileData, { text: prompt }] } ];

  const result = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents,
    config: {
      responseMimeType: "application/json"
    }
  });

  try {
    return JSON.parse(result.text);
  } catch (e) {
    console.error("Failed to parse segmentation JSON:", result.text);
    throw new Error("Erro ao processar a estrutura dos segmentos.");
  }
};

export const generateImageFromPrompt = async (prompt: string, aspectRatio: string = "9:16", apiKey?: string) => {
  const ai = getAI(apiKey);
  
  let finalPrompt = prompt;
  if (prompt.match(/[áéíóúçãõ]/i)) {
    console.log("[Gemini Image] Prompt contains Portuguese characters, translating...");
    finalPrompt = await translateToEnglish(prompt, aspectRatio, apiKey);
  }

  // 'nana banana' maps to 'gemini-2.5-flash-image'
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: [{ parts: [{ text: finalPrompt }] }],
    config: {
      imageConfig: {
        aspectRatio: (aspectRatio === '1:1' || aspectRatio === '3:4' || aspectRatio === '4:3' || aspectRatio === '9:16' || aspectRatio === '16:9') 
          ? aspectRatio as any 
          : '9:16'
      }
    }
  });

  const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!imagePart?.inlineData?.data) {
    throw new Error("Falha ao gerar imagem com o modelo Gemini.");
  }

  return `data:image/png;base64,${imagePart.inlineData.data}`;
};

export const parseVeoEdits = async (rawText: string) => {
  const lines = rawText.split('\n').filter(l => l.includes('|'));
  return lines.map(line => {
    const parts = line.split('|').map(p => p.trim());
    if (parts.length >= 3) {
      const timestampStr = parts[0].replace('s', '').replace('[', '').replace(']', '');
      const durationStr = parts[1].replace('s', '').replace('[', '').replace(']', '');
      
      const timestamp = parseFloat(timestampStr);
      const duration = parseFloat(durationStr);
      const prompt = parts[2];
      const phrase = parts[3] || '';
      
      if (isNaN(timestamp) || isNaN(duration)) return null;

      return {
        id: Math.random().toString(36).substr(2, 9),
        timestamp,
        duration,
        type: 'image' as const,
        value: `B-roll VEO (${duration}s)`,
        aiPrompt: prompt,
        phrase
      } as any;
    }
    return null;
  }).filter(Boolean) as any[];
};
