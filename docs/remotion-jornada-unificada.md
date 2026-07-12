# Jornada Unificada — Produção de Criativos (Metavise)

> Documento de desenho. Trava o modelo da jornada **antes** de mexer no código.
> Status: desenho aprovado na conversa de 29–30/05/2026. Implementação pendente.

---

## 1. Contexto

O usuário já passou pelo topo da jornada (Fonte → Persona → **Plano**) e o Plano
gerou **~15 propostas de criativo** (`CreativeBrief`) para o Meta Ads (Andromeda).
A partir daqui ele precisa **produzir cada um dos 15**.

A grande decisão: **não existem "dois braços".** É **uma jornada só**. O que muda
de um criativo para outro é **como cada parte é produzida** — uma escolha por parte,
não um braço escolhido lá no começo.

---

## 2. Princípio

```
Fonte → Persona → Plano (15 propostas) → Copy →
            ↓
      PRODUÇÃO  (por criativo, um de cada vez — tudo bem, desde que rápido)
            ↓
          Final
```

Tudo isso já é **um app só, um `config`**. "Braços" eram só um andaime mental.

---

## 3. A estrutura: 3 partes (hoje são 2)

Hoje o app pensa em **hook + corpo** (ex.: voz do hook / voz do corpo). A mudança
pequena é **adicionar o CTA** como terceira parte:

```
[ HOOK ]  [ CORPO ]  [ CTA ]
```

- Cada parte é **opcional**. O usuário pode apagar qualquer uma.
- **Mínimo: 1 parte.** O que sobrar, na ordem, é o vídeo.
- Exemplos válidos: só corpo (avatar) · hook + corpo (sem CTA) · só hook (teaser).

---

## 4. Fontes por parte

Ao editar **cada parte**, o usuário escolhe **de onde vem** o conteúdo:

| Fonte | O que produz | Velocidade / custo |
|---|---|---|
| ✍️ **Escrever** | texto → vira clipe (renderizado pelo Remotion) | instantâneo / centavos |
| 🎙️🧑 **Gerar** (ElevenLabs + HeyGen) | voz e/ou avatar falando → clipe | minutos / créditos |
| ⬆️ **Upload** | vídeo/imagem/áudio do usuário | instantâneo |
| 🔗 **Puxar do projeto** | hook/copy/áudio/avatar já feitos no projeto (exceto edição) | instantâneo |

Cada parte é **independente** — pode misturar (ex.: hook escrito + corpo avatar).

---

## 5. Remotion = acabamento POR PARTE (não template do criativo inteiro)

Esta é a virada principal do desenho:

> Ao editar cada parte, há a opção **"incluir Remotion"**. Se o usuário escolher,
> aparece **só aquela parte** no Remotion — não as três.

Então o Remotion **não é** um template monolítico que veste as 3 fases. Ele é um
**acabamento aplicável por peça**:

- **Estilos de HOOK**: texto centralizado, POV, título de lista, pergunta…
- **Estilos de CORPO**: demo na moldura de celular, texto grande, lista, comparação,
  checklist, chat, número, depoimento…
- **Estilos de CTA**: logo + botão (algumas variações).

→ Os **14 templates atuais** (que hoje cobrem as 3 fases) serão **quebrados nessas
peças por parte**. Os 14 inteiros podem sobreviver como um **"modo expresso"**:
aplica um conjunto combinando nas 3 de uma vez, para quem quer tudo-Remotion rápido.

**Regra que amarra tudo:**
- Parte de **texto** → precisa do Remotion para virar clipe.
- Parte de **vídeo** (avatar/upload) → pode ir **crua** ou **com Remotion** (decorada).

---

## 6. Montagem final

Cada parte vira **um clipe**. No fim:

```
[clipe hook] + [clipe corpo] + [clipe CTA]
        ↓  juntar (ffmpeg /concat — já existe)
   + transição na junção (opcional)
   + marca consistente em todas as partes
   + legenda (Remotion OU ZapCap — já existe)
        ↓
     VÍDEO FINAL (9:16 por padrão)
```

Dois modos de montagem (mesmos espaços):

| Modo | Resultado | Quando |
|---|---|---|
| 🎨 **Com Remotion** | parte(s) decorada(s): marca, legenda, transição, animação | quer acabamento |
| 🔗 **Juntar direto** (concat) | clipes colados, cru | só vídeo, sem firula |

**Trade-off honesto:** montar parte-por-parte dá flexibilidade total, mas perde um
pouco da "coesão de peça única" (transições/layout desenhados atravessando as 3).
Mitiga-se com marca consistente + transição no concat.

---

## 7. Avatar + Remotion (o caso premium)

O clipe do HeyGen é tratado como **mais uma fonte de vídeo**. Se o usuário gerar o
avatar e **ainda** quiser Remotion, o Remotion **decora em volta** do avatar:
moldura, marca, legenda automática (do áudio do avatar), hook/CTA, transições.

Três caminhos com avatar:
1. Avatar **sem Remotion** → cru (concat).
2. Avatar **com Remotion** → enfeitado (premium).
3. **Sem avatar**, só Remotion → template puro (massa, barato).

→ O Remotion **não compete com o HeyGen — turbina o HeyGen.**

---

## 8. A ponte com o Plano (recomendação automática)

Cada proposta do plano já vem com `style` (`CreativeStyle`) e `hook` escritos.
O `style` mapeia quase 1:1 para método/estilo de parte:

| `style` do plano | → sugestão |
|---|---|
| `demo` | corpo: demo de tela (Remotion) |
| `depoimento` | depoimento (Remotion) ou avatar |
| `antes_e_depois` | antes/depois (Remotion) |
| `comparacao` | comparação (Remotion) |
| `lista_beneficios` | checklist (Remotion) |
| `mecanismo_revelado` | pergunta → resposta (Remotion) |
| `historia_pessoal` | POV / avatar |
| `autoridade_explica` | tutorial / avatar |

Ao abrir um criativo do plano na produção, ele já vem com **estilo + hook
pré-preenchidos**. Recomendação, não trava — o usuário troca à vontade.
Fallback quando `style` é texto livre: cai em "demo" ou "texto".

---

## 9. Custo e velocidade (deixar visível na UI)

| Fonte da parte | Velocidade | Custo |
|---|---|---|
| escrever / template / upload / puxar | instantâneo | centavos |
| gerar avatar (HeyGen) | minutos (assíncrono) | créditos |

A régua "massa vs artesanal" não some — vira **granular, por parte**. A UI precisa
mostrar isso na hora da escolha.

---

## 10. O que reusa vs o que é novo

**Reusa (já existe):** topo da jornada (Fonte/Persona/Plano/Copy), HeyGen, ElevenLabs,
Runway, ZapCap (legenda), `/concat` (ffmpeg), jobStore, storage, e a estrutura
hook/corpo da Voz/Avatar.

**Novo / a fazer:**
1. Adicionar **CTA** como 3ª parte (generalizar hook/corpo → hook/corpo/cta).
2. Editor de parte com as 4 fontes + opção "incluir Remotion (só esta parte)".
3. Quebrar os 14 templates em **estilos por parte** (hook/corpo/cta).
4. Montagem: render por parte → concat → final (+ transição + legenda).
5. Cadastro de **Marca** (nível de conta; hoje stub em localStorage).
6. Recomendação do plano (style → estilo/método por proposta).
7. Render em massa/nuvem (Remotion Lambda) — quando escalar.

---

## 11. Decisões ainda em aberto

- Manter os 14 templates inteiros como "modo expresso" **ou** só as peças por parte?
- Transição entre partes no concat: padrão ligada ou desligada?
- Onde mora o cadastro de Marca de vez (Firestore no perfil do usuário).
- Legenda no caminho "cru": Remotion ou ZapCap por padrão?

---

## 12. Mapa resumido

```
Plano (15 propostas, cada uma com style+hook)
        │  (recomenda estilo/método por proposta)
        ▼
Para cada criativo:
   ┌─ HOOK  ─ fonte: escrever / gerar / upload / puxar  [+ Remotion?]
   ├─ CORPO ─ fonte: escrever / gerar / upload / puxar  [+ Remotion?]
   └─ CTA   ─ fonte: escolher pronto / escrever / ...   [+ Remotion?]
        │   (qualquer parte é opcional; mínimo 1)
        ▼
   Montagem: cada parte → clipe → concat
        + marca + transição + legenda
        ▼
     VÍDEO FINAL (9:16)
```
