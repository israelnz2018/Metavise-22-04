# Metavise — Blueprint Feature (Context & Status)

> **Audience:** future Claude sessions (or the user) picking up this work
> after a context reset. This file is the source of truth for everything
> we decided about the "VSL → 15 creatives" feature. **Read this first.**

---

## 🟢 ESTADO ATUAL DO FLUXO (2026-05-31) — LEIA ISTO PRIMEIRO

> Este bloco **sobrescreve** qualquer descrição de fluxo nas seções
> históricas abaixo (§5, §15, etc.). As seções antigas ficam como
> **registro do que foi feito**, mas o fluxo de UX evoluiu. Quando houver
> conflito, **vale este bloco.**

**Fluxo de entrada (hoje):**
1. **Criar projeto** → o modal pede **só o nome** (sem escolher VSL/Produto;
   todo projeto nasce `complete`). Vai **direto pra aba "Planejamento"**.
2. **Aba "Planejamento"** (era "Identificar Persona") é **unificada**:
   - **Topo:** os 3 inputs de material (YouTube / landing / texto) — a IA
     extrai e auto-preenche as perguntas. (A antiga aba "Fonte do Produto"
     foi **removida da navegação**; o arquivo `SourceTab.tsx` segue no repo.)
   - **Meio:** as perguntas de persona → "Gerar 3 Personas" → "Salvar".
   - **Fim:** o **Plano de Marketing** renderiza embutido (`#plan-section`).
     O PlanTab **não é mais página separada**.
3. **Botões do plano:** o **clássico** ("Gerar Plano de Marketing") fica à
   mostra; o **mensal calibrado** fica recolhido num `<details>`.

**Coisas que MUDARAM e contradizem as seções antigas:**
- ❌ Removido o CTA "Ir pro Plano de Marketing" da PersonaTab (§2.1/§5) e o
  handler `handleGoToPlan`. O plano agora aparece sozinho ao salvar personas.
- ❌ Removido o "Enviar este persona pra Copy" (Path 1, §5) e
  `handleSelectPersona`. Removidos também os checkboxes "Incluir" dos cards.
- ✅ **Recolocado** o botão **"+ Adicionar Subprojeto"** na seção
  Subprojetos/Versões (§15.7 dizia que tinha sido removido). Ele **não abre
  popup** — vai direto pro Planejamento (`handleNewSubproject` →
  `proceedNewSubproject` que agora **sempre** roteia pra `persona`).
- ✅ **"Carregar Versão"** cai na **aba mais avançada com conteúdo**
  (edit-zap > avatar > voz > gancho > copy > persona), não mais em `source`.

**Invariante crítica (causa de bug recorrente):**
- A seção de Plano só aparece quando `config.copy.personasWithWeights` tem
  itens (`isV2`). Projetos antigos têm `savedPersonas` mas **não** esse
  campo. O helper **`ensurePersonaWeights(cfg)`** (App.tsx) deriva os pesos
  de `savedPersonas` quando faltam — aplicado em **carregar projeto,
  carregar versão e novo subprojeto**. Salvar personas também popula o campo.

**Ordem real das abas (STEPS em `src/lib/constants.ts`):**
`Integrações · Meus Projetos · Planejamento · Copy · Copy do Gancho · Voz ·
Remotion · Avatar · Edição Zap · Edição Premium · Exportar`

**Pendências ativas:** (a) Plano vs Avulso na criação · (b) aviso de
retenção "expira em X dias" · (c) Remotion render na nuvem · (d) quebrar os
14 templates por parte. Nenhuma iniciada.

---

## 1. The Goal in One Paragraph

User pastes a 1-hour VSL (or describes their own product), and the app
generates a **complete marketing plan + 15 creative briefs ready to execute**.
Each brief becomes a subprojeto when the user clicks "Criar". The user then
goes through the existing pipeline (Copy → Voice → Avatar → Edit → Export)
to produce each creative. The goal is to take the user from VSL to 15
finished ad creatives with minimal friction.

---

## 2. The Cardinal Principle

> **"Sugerimos, ele decide."**

The IA _always_ proposes. The user _always_ has control:

- Suggested persona weights → user can adjust
- Suggested distribution of 15 briefs → user picks which personas to include
- Suggested brief fields → all 9 fields editable
- Suggested subprojeto name → confirmation popup (no edit needed for it)

**Tab-to-tab transitions NEVER auto-generate** anything. They carry data
forward. The user clicks an explicit "Gerar X" button when they want
something produced.

---

## 3. Andromeda Research (the foundation)

Confirmed via Meta's official engineering blog + 6+ agency sources
(Jon Loomer, Foxwell Digital, Logical Position, Anchour, etc.):

| Fact                                                                                    | Implication for our app                                                     |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Creative quality = 56% of campaign performance                                          | Quality of briefs matters more than targeting                               |
| 10-15 conceptually distinct creatives per campaign                                      | **Default: 15 briefs** (user can adjust 10-20)                              |
| 1 campaign, 1 ad set Advantage+ broad                                                   | Don't split personas across ad sets                                         |
| **Personas live inside creatives, not in ad sets**                                      | Each brief targets ONE specific persona                                     |
| Andromeda collapses similar creatives into one Entity ID                                | Diversity must be REAL — vary awareness × angle × hook × duration × persona |
| Controlled test: 25 diverse creatives in 1 ad set beat 5 ad sets × 5 by 17% conversions | Validates the "all in one ad set" approach                                  |

**Source URLs** (preserved for re-research if Anthropic adds web search):

- engineering.fb.com/2024/12/02/production-engineering/meta-andromeda-advantage-automation-next-gen-personalized-ads-retrieval-engine/
- jonloomer.com/meta-andromeda-creative-diversification/
- foxwelldigital.com/blog/how-andromeda-has-changed-meta-advertising-a-practical-guide

---

## 4. Weighted Persona Model

A VSL is typically built for **ONE persona** (sometimes 2). The current
system extracts 3 personas, but **only the principal is truly extracted**.
Personas 2 and 3 are inferences by Claude — sometimes solid, sometimes
"stretched" (low confidence speculation).

### Schema (defined in `src/types/project.ts`)

```typescript
WeightedPersona {
  id: string                    // "persona_principal" | "persona_secundaria" | ...
  name: string                  // "Sofredor Crônico 60-75"
  description: string
  awareness: AwarenessLevel     // 'unaware' | 'problem_aware' | etc.
  painPoints: string[]
  confidence: number            // 0-1. ≥0.7 = extracted. <0.5 = stretch.
  suggestedWeight: number       // 0-1. SUM OF ALL = 1.0
  evidence: string[]            // quotes from source material
  isStretch: boolean            // true when confidence < 0.5
}
```

### Distribution example (Arya Leaf VSL)

- Persona Principal "Sofredor Crônico 50-75" — **0.65 weight**, confidence 0.9, NOT stretch
- Persona Secundária "Cuidador/Filho preocupado" — **0.30 weight**, confidence 0.75, NOT stretch
- Persona Terciária "Preventivo 30+" — **0.05 weight**, confidence 0.3, **isStretch: true**

For 15 briefs: 10 / 4 / 1 (or 8/4/0 if user unchecks the stretch).

---

## 5. The Two User Flows

```
                ┌──────────────────────┐
                │  New project modal   │
                │ "Tenho produto" OR   │
                │ "Tenho VSL/LP"       │
                └──────────┬───────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
        VENDEDOR                    AFILIADO
        (only product)              (has VSL/LP)
              │                         │
        Source: text/form          Source: paste link
        Claude extracts            Claude transcribes
        ProductInfo                + extracts ProductInfo
              │                         │
              └────────┬────────────────┘
                       ▼
        PersonaTab — auto-filled by personaFromProduct()
        User clicks "Gerar 3 Personas" → 3 cards w/ confidence
                       │
              ┌────────┴────────┐
              ▼                 ▼
        PATH 1 (fast)      PATH 2 (full plan)
        Click "Escolher    Checkbox 1-3 personas
        esta" on a card    Click "Ir pro Plano"
              │                 │
              ▼                 ▼
        CopyTab            PlanTab v2
        (existing flow,    - Personas + weights at top
        single persona)    - Slider 15 (default)
                           - "Gerar Plano (Andromeda)"
                           - Strategy macro + 15 brief cards
                                 │
                                 │ Click brief → ConfirmModal
                                 ▼
                           Variant created
                           (snapshot of brief)
                                 │
                                 ▼
                           CopyTab with active-brief banner
                           Form pre-filled
                           User clicks "Gerar Copy" (existing)
                                 │
                                 ▼
                           Voice → Avatar → Edit → Final
                           (rest of pipeline unchanged)
```

---

## 6. Subprojeto vs Version vs Criativo 16+

| Mudou no briefing?                              | Mesmo criativo conceitualmente? | Decisão                                                  |
| ----------------------------------------------- | ------------------------------- | -------------------------------------------------------- |
| Não, só re-renderizando avatar/voz/edição       | Sim                             | **Versão interna** do mesmo subprojeto                   |
| Não, só mudou avatar pra A/B explícito          | Sim, conceitualmente            | **Novo subprojeto** (Meta tracking) — botão MM já existe |
| Sim (ângulo, hook, awareness, persona, duração) | Não, conceito diferente         | **Novo subprojeto** "Criativo 16"                        |

The user must be **explicitly aware** when creating a Criativo 16+. The
"Criar variação grande" modal (Phase 6 — not yet built) must say loudly:

> _"Você está criando um NOVO criativo (Criativo 16)"_

Plan list grows beyond 15 organically. No artificial cap.

---

## 7. NEVER Change (Core Generation Pipeline)

The Blueprint feature is **purely additive**. The following must remain
exactly as they are:

- **Copy generation** — `generateAdCopyWithClaude` with Schwartz beats, the
  awareness-based prompt logic, hooks bible, streaming
- **Voice** — ElevenLabs flow, premium voices, hover preview, copy
  optimization for voice
- **Avatar** — HeyGen integration, gallery, filters, render polling
- **Hook Visual** — Imagen 4 + VEO image/video generation
- **EditZap** — ZapCap + headline + intercut + join
- **Edit2** — AssemblyAI + auto-edit
- **Variant lifecycle** — `handleSaveProject`, Firestore writes, etc.

When a brief is executed, it populates the SAME `config.copy.answers.*`,
`config.copy.angleIdea`, `config.copy.hookSelecionado`,
`config.copy.targetWordCount` fields the existing pipeline already reads.
Downstream tabs don't know the variant was born from a brief.

---

## 8. Phase Status

### ✅ DONE

**Phase 1 — Foundation**

- `1.1` Schemas (`src/types/project.ts`): `WeightedPersona`, `CreativeBrief`,
  `MarketingBlueprint`, awareness/angle/style/CTA/emotion enums.
  `AdConfig.copy` extended with `personasWithWeights?` + `creativeBriefs?`.
- `1.2` Persona prompt (`src/lib/claudeService.ts` `discoverPersonaWithClaude`)
  now outputs `confidence`, `suggestedWeight`, `evidence[]`, `isStretch`.
- `1.3` `/api/claude/marketing-plan` (`server/routes/claude.routes.ts`)
  expanded — accepts `personas: WeightedPersona[]` + `targetCount`, returns
  `{ plan, briefs[] }`. Server-side largest-remainder distribution.
  Client helper `generateMarketingBlueprint()` exposed.

**Phase 2 — Persona UI**

- `2.1` PersonaTab — confidence badges (green/amber/red), suggestedWeight
  badge, "⚠️ fraca" chip for isStretch, checkboxes pre-selected by
  confidence, "Ir pro Plano de Marketing (N personas)" CTA.
- `2.2` App.tsx `handleGoToPlan` — maps LLM → WeightedPersona, normalizes
  weights, persists `config.copy.personasWithWeights`, navigates to plan.
- `2.3` SourceTab → PersonaTab auto-fill — useEffect detects ProductInfo +
  empty form + `personaAutoFilled` flag, runs `personaFromProduct` silently.

**Phase 3 — PlanTab v2 + brief loop**

- `3.1` PlanTab v2 header — 3 persona-cards selectable, slider 10-20
  (default 15), "Gerar Plano (Andromeda)" button. v1 (legacy auto-fetch)
  preserved when no `personasWithWeights`.
- `3.2` Briefs grid — 15 cards, color-coded by persona, hook preview,
  meta badges (awareness/duration/angle), rationale, edit + execute buttons,
  status "✓ executado" / "⚪ pendente".
- `3.3` `BriefEditModal` (`src/components/BriefEditModal.tsx`) — all 9 fields
  editable: persona dropdown, awareness 1-5, angle datalist, hook textarea,
  duration select, style datalist, emotion datalist, CTA select, promise,
  rationale.
- `3.4` Confirm popup + variant creation — `handleConfirmBriefExec` creates
  variant with id = brief.id, populates config.copy.\* fields, sets
  `executedVariantId` on the brief, navigates to CopyTab.
- `3.5` CopyTab active-brief banner — small chip at top "Executando Criativo
  N · Persona · Ângulo · Consc.X · Ys" + "← Voltar ao plano" button.

### ⏳ PENDING

**Phase 4 — Wiring polish (~2-3h)**

- Edge cases in tab transitions (e.g. user opens CopyTab directly without
  brief, banner should not show)
- Hash personas to detect staleness — if user edits persona after
  generating plan, show "Plano desatualizado, regerar?" chip
- Properly distinguish "open existing variant" vs "create new" when click
  brief that's already executed
- Test that legacy (single-persona) projects still work end-to-end

**Phase 5 — Vendedor flow (~2-3h)**

- NewProjectModal: explicit "Tenho produto" vs "Tenho VSL/LP" choice
- SourceTab: guided form mode for vendedor (4-5 simple questions OR free
  text "describe your product")
- Backend `/extract-product-info` already accepts text input — wire up the
  UI to send free-text without VSL URL

**Phase 6 — "Criar variação grande" (Criativo 16+) (~3-4h)**

- Button inside subprojeto (FinalTab or ProjectsTab detail) "Criar variação
  grande deste criativo"
- Modal with editable brief fields + LOUD warning "Você está criando
  Criativo 16" (the number is dynamic)
- On confirm: append new brief to plan + create variant + navigate to Copy
- Brief gets `derivedFromBriefId` pointing to source

**Phase 7 — Polish (~2-3h)**

- Better visual feedback in plan grid (filters by status/persona)
- ProjectsTab detail view repensado pra mostrar 15+ variants organizados
- Microcopy / onboarding tooltips
- Empty states

---

## 9. Architecture Summary (Files Touched)

### Types (`src/types/project.ts`)

Added: `WeightedPersona`, `CreativeBrief`, `MarketingBlueprint`,
`AwarenessLevel`, `CreativeAngle`, `CreativeStyle`, `CtaStyle`, `PrimaryEmotion`.

### Backend

- `server/routes/claude.routes.ts` — `/marketing-plan` accepts new shape,
  prompt rewritten to generate plan + N briefs with persona-weighted
  distribution. `max_tokens: 12000`.

### Client lib

- `src/lib/claudeService.ts` — `discoverPersonaWithClaude` prompt updated
  (Phase 1.2). New helper `generateMarketingBlueprint`.

### Components (new)

- `src/components/BriefEditModal.tsx` — full edit form for 1 brief

### Pages modified

- `src/pages/PersonaTab.tsx` — confidence badges, checkboxes, "Ir pro Plano"
  CTA, auto-fill useEffect
- `src/pages/PlanTab.tsx` — v2 header, briefs grid, dual mode (legacy + v2)
- `src/pages/CopyTab.tsx` — active-brief banner
- `src/pages/SourceTab.tsx` — unchanged in this feature (auto-fill happens
  in PersonaTab on mount, not in SourceTab)

### App.tsx

- `AdConfig.copy` extended with `personasWithWeights`, `creativeBriefs`,
  `personaAutoFilled`, `activeBriefId`
- New handlers: `handleGoToPlan`, `persistBriefs`, `handleSaveEditedBrief`,
  `handleBriefClick`, `handleConfirmBriefExec`, `briefToSubprojectName`,
  `mapNumericAwarenessToString`
- New state: `editingBrief`, `pendingBriefExec`
- PlanTab usage extended with all new props
- New modals mounted: `BriefEditModal`, `ConfirmModal` for brief execution

---

## 10. How to Test (End-to-End)

1. `npm run dev` (server starts on :3000)
2. Open localhost:3000 in browser
3. Create new project ("complete" type)
4. Go to Source → paste the **Arya Leaf VSL link** (or any YouTube VSL)
5. Click "Extrair informações"
6. Navigate to Persona — form should auto-fill (toast: "Persona preenchida
   automaticamente")
7. Click "Gerar 3 Personas"
8. Should see 3 cards with confidence badges + checkboxes
9. Click "Ir pro Plano de Marketing (N personas)"
10. PlanTab loads — 3 persona-cards at top + slider (15) + "Gerar Plano"
11. Click "Gerar Plano (Andromeda)" — wait ~30-60s
12. Strategy macro + 15-brief grid should appear
13. Click "Editar" on a brief → modal opens with 9 fields
14. Click "Criar Subprojeto" on a brief → popup confirms → CopyTab opens
    with banner "Executando Criativo X" + form pre-filled
15. Click existing "Gerar Copy" button (NOT auto) → streaming text appears

---

## 11. How to Revert

### Selective rollbacks

```
# Revert Phase 3 only (keep Phases 1+2):
git reset --hard 56e5ed8     # last Phase 2 commit

# Revert Phases 2+3 (keep Phase 1):
git reset --hard 4aa2117     # last Phase 1 commit

# Revert ALL Blueprint work:
git reset --hard checkpoint-pre-blueprint
```

The `checkpoint-pre-blueprint` tag is the safety net — it points to
commit `ec471f5` (end of B1 — persistent job queue). Everything Blueprint-
related came after.

### Single commit revert (preserves history)

```
git revert <commit-hash>
```

---

## 12. Open Questions / Gotchas

- **Subproject vs Variant terminology** — codebase uses `variants` in the
  data model but UI/UX calls them "subprojetos". They're the same thing.
- **`personasWithWeights` vs `generatedPersona.personas`** — these are
  DIFFERENT shapes living in DIFFERENT slots. The legacy generatedPersona
  is `App.tsx` local state (from `discoverPersonaWithClaude`). The new
  WeightedPersona[] is `config.copy.personasWithWeights` (persisted).
  Phase 2.2 maps between them.
- **Brief.id == Variant.id** — by design, deterministic mapping so the
  PlanTab can show "✓ executado" by looking up brief.id in the variants
  list. Don't change this without updating `briefToVariantMap` computation
  in App.tsx.
- **Empty briefs[]** — if Claude returns 0 briefs (unlikely but possible),
  the grid hides entirely. The user can re-trigger by clicking "Gerar Plano"
  again.
- **Persona ID stability** — currently derived from `rank` ("persona_principal"
  etc.). If we ever ditch the rank field, IDs need a new generation strategy.

---

## 13. Quick Reference — Key Files

```
src/types/project.ts                       Schemas
src/lib/claudeService.ts                   Client helpers (incl. blueprint)
src/components/BriefEditModal.tsx          Edit modal (NEW)
src/pages/PersonaTab.tsx                   Persona UI w/ checkboxes
src/pages/PlanTab.tsx                      v2 PlanTab w/ briefs grid
src/pages/CopyTab.tsx                      Active-brief banner
src/App.tsx                                Handlers + state + wiring
server/routes/claude.routes.ts             /marketing-plan endpoint
```

---

## 14. Commits Index (Blueprint Feature)

```
33e87a7  feat(credits) — chip clicável + endpoint grant + welcome 10k
e3f4d9a  fix(credits) — catch Firestore credentials → não crasha
9c32766  fix(persona) — persona-from-product max_tokens 4000
5d6d4b1  fix(music) — mensagem clara missing_permissions ElevenLabs
a402815  feat(editzap) — música de fundo (upload MP3 + IA)
a399e0e  fix(persist) — retry Firebase + fallback local
5a3d185  fix(editzap) — detector de vídeo quebrado na Galeria
8574fbd  feat(intercut) — caps + Impact + quebra por sentença
a565381  fix(intercut) — downloadFile suporta /generated/
d22c64b  feat(intercut) — palavras/linha (1-8) + fusão gaps
1662aab  fix(intercut) — race condition matava polling
985e437  fix(intercut) — logs extras no backend
49cca44  fix(intercut) — suporte /generated/ no /analyze/submit
171e5d0  fix(intercut) — logs verbose + erros reais no modal
612044b  chore(dev) — tsx watch hot reload backend
c7ce4e9  perf(intercut) — análise AssemblyAI ~40-50% mais rápida
b4c531c  fix(intercut) — polling com feedback no Cortes
7425f6c  feat(editzap) — Cortes pretos manual com karaoke
7d26680  fix(zapcap) — race condition causava 4 vídeos duplicados
7f7fcbc  fix(ui) — contraste cards coloridos dark mode
0bed712  fix(ui) — texto duplo dark: ilegível
1a86aed  feat(blueprint) Fase 5.4 — NewProjectModal só Blueprint
2fe07c1  feat(blueprint) Fase 5 — Criativo 16+ (variação grande)
e72c724  docs(blueprint) Fase 4 — Vendedor + Dados do Projeto
acac931  Fase 4 — Dados do Projeto + Porta A (persona)
74d51c3  Fase 4 — entry point com escolha VSL vs Produto
7a4cce3  Phase 3.x docs — BLUEPRINT_FEATURE.md context handoff
769f43f  Phase 3.5 — CopyTab active brief banner
2051be0  Phase 3.3 + 3.4 — BriefEditModal + create-subprojeto popup
89711ea  Phase 3.2 — briefs grid
041d88f  Phase 3.1 — PlanTab v2 header
56e5ed8  Phase 2.3 — auto-fill PersonaTab from ProductInfo
9656724  Phase 2.2 — handleGoToPlan wired in App.tsx
326821d  Phase 2.1 — PersonaTab badges + checkboxes + 'Ir pro Plano'
4aa2117  Phase 1.3 — /marketing-plan returns { plan, briefs }
32fa92e  Phase 1.2 — persona prompt outputs confidence + weight
168c303  Phase 1.1 — schemas for CreativeBrief + WeightedPersona
ec471f5  ← checkpoint-pre-blueprint (safety net)
```

Use `git log --oneline checkpoint-pre-blueprint..HEAD` to see the full
list at any time.

---

## 15. Fase 4 — Vendedor flow + Dados do Projeto

Introduces two parallel entry points so the same Blueprint engine serves
both affiliates (who have a VSL/landing) and pure sellers (who only have
the product). The mental model: persona discovery is the only step that
differs by user type — everything downstream (Plan → 15 briefs → variants)
is shared.

### 15.1 NewProjectModal — `sourceMode` choice

When the user selects "Projeto Completo" (Blueprint), the modal now shows
a second card row asking:

📺 "Tenho VSL ou landing pronta" → `sourceMode='vsl'`
🎁 "Só tenho o produto pra anunciar" → `sourceMode='product'`

The choice persists at `config.copy.sourceMode`. Specialty types
(copy/video/edit) don't see this and behave as before.

### 15.2 Post-create routing in `handleCreateProject`

```
sourceMode='vsl'      → SourceTab opens directly in 'auto' mode
                        (skip the "Manual vs Automática" picker — already
                        decided in the modal)

sourceMode='product'  → PersonaPathModal opens automatically
                        (the new Project becomes pendingNewSubproject;
                        proceedNewSubproject routes based on path)

undefined (legacy)    → SourceTab opens in 'choose' mode (original behavior)
```

The `SourceTab` gained an `initialMode` prop (default `'choose'`) to
support this without breaking projects without sourceMode.

### 15.3 `proceedNewSubproject` — vendedor branch

`proceedNewSubproject` detects vendedor first-time setup
(`config.copy.sourceMode === 'product'`) and routes differently from
legacy subprojeto creation:

```
                       │ Vendedor (sourceMode='product')  │ Legacy
─────────────────────  ┼──────────────────────────────────┼──────────────
'known' path           │ → PersonaTab (9 campos vazios)   │ → CopyTab direto
                       │   discoveryMode='known'          │   (skip Blueprint)
─────────────────────  ┼──────────────────────────────────┼──────────────
'discover' path        │ → CopyTab modo 'discovering'     │ → PersonaTab
                       │   ATIVA o código órfão das 5     │   (9 campos vazios)
                       │   perguntas soft (linhas 386-509
                       │   do CopyTab.tsx que estavam
                       │   dormentes)
```

The 5 soft questions (produto/problema/resultado/cliente/beneficiário)
end with `handleGeneratePersona(discoveryAnswers)` which generates the
3 personas, same as the 9-question form.

### 15.4 "Dados do Projeto" — new concept on detail view

Introduces a new section on the ProjectsTab detail view that groups
everything that exists BEFORE turning into a subprojeto. Lives in
`ProjectDataSection` (private component at bottom of `ProjectsTab.tsx`).

Rendered conditionally based on what data is present:

```
┌───────────────────────────────────────┐
│ 📋 Dados do Projeto                   │
│                                       │
│ 🎬 Material da fonte (if extracted):  │
│   • productInfo.productName           │
│   • productInfo.offer                 │
│   • productInfo.mainPain              │
│   • sourceText length                 │
│                                       │
│ 👥 Personas identificadas (if any):   │
│   ← cards clicáveis (Porta A)         │
│                                       │
│ 💡 Sugestões de criativos (if any):   │
│   ← bullets verticais (Porta B)       │
│     ✓ executado vs ○ pendente         │
└───────────────────────────────────────┘
```

**Subprojetos só nascem via popup.** The grid is read-only data until
the user explicitly creates a variant via one of the 2 portas.

### 15.5 Porta A — persona → subprojeto

`handleSelectPersonaFromProject(project, persona)`:

1. Makes project current via `handleLoadProject(project, 'projects')`
2. Sets `pendingPersonaExec` → triggers ConfirmModal
3. On confirm: `handleConfirmPersonaExec`:
   - Builds variant config from `productInfo` + `persona.raw`
   - Empty brief (cliente preenche ângulo/hook/duração na Copy)
   - `variantId = 'persona-{persona.id}-{Date.now()}'`
   - Persists to Firestore, navigates to Copy

The variant carries `personaOrigin: { id, name }` so future UI can
distinguish persona-origin from brief-origin variants.

### 15.6 Porta B — brief → subprojeto (reuses Phase 3.4)

`handleSelectBriefFromProject(project, brief)`:

1. Makes project current
2. Delegates to existing `handleBriefClick(brief)` → `pendingBriefExec`
3. Same flow as Phase 3.4 (snapshot the brief, create variant with
   `variantId === brief.id` for deterministic mapping)

### 15.7 Removed: "Novo Subprojeto" button

The button is gone from the project detail view. Subprojetos nascem
ONLY via the 2 portas above. Legacy projects without briefs/personas
have no create-variant button — solution for that is deferred (the
fallback would be a "Gerar Plano agora" CTA in the empty Dados
section, but we keep it simple per "não vamos complicar").

### 15.8 What did NOT change

- PlanTab continues to exist as a separate page (decision: don't merge
  into Dados do Projeto for now — "depois mudamos e juntamos se precisar")
- copy/video/editing project types still exist in NewProjectModal
  (decision adiada — sempre Completo planned for future)
- All variant generation pipelines (Copy → Voice → Avatar → Edit →
  Export) untouched
- All Phase 1-3 work intact

### 15.9 Commits

```
74d51c3  Fase 4 — entry point com escolha VSL vs Produto
acac931  Fase 4 — Dados do Projeto + Porta A (persona)
e72c724  Fase 4 docs
```

---

## 16. Fase 5 — Criativo 16+ (variação grande)

Permite ao cliente expandir o plano além dos 15 briefs originais — para
quando ele quer um conceito DIFERENTE (mudou ângulo, hook, persona,
awareness ou duração de forma significativa) e não apenas uma
re-renderização do mesmo conceito.

### 16.1 Decisão chave: Versão vs Criativo Novo

| Mudou no briefing?                    | Mesmo conceito? | Decisão                              |
| ------------------------------------- | --------------- | ------------------------------------ |
| Não, só re-render avatar/voz/edição   | Sim             | Versão interna do subprojeto         |
| Mudou A/B de avatar pra Meta tracking | Sim             | Novo subprojeto (botão MM)           |
| Sim — ângulo/hook/awareness/persona   | NÃO             | **Novo Criativo 16+** (esta feature) |

O warning banner amber LOUD no BriefEditModal reforça isso pro cliente
não confundir.

### 16.2 BriefEditModal — prop `mode`

```typescript
mode?: 'edit' | 'create'   // default 'edit' preserva Fase 3.3
```

Quando `mode='create'`:

- Header: ícone amber + título "Criar Criativo {N} (variação grande)"
- Banner amber loud entre header e form com warning + dica de usar versão
  interna pra re-renderizações
- Botão "Salvar alterações" vira "Criar Criativo {N} e ir pra Copy" (amber)

### 16.3 Botão CTA na seção Dados do Projeto

No fim da lista de briefs (só renderiza se `briefs.length > 0`):

```
[💡 Criar Criativo {N+1} (variação grande)]   ← amber, ring-amber-300
```

Calculado como `briefs.length + 1` — sequencial natural.

### 16.4 Handler `handleStartBigVariation`

1. Se projeto ≠ current → `handleLoadProject(project, 'projects')`
2. Calcula `nextIndex = max(briefs.map(b.index)) + 1` (fallback 16)
3. Monta draft de CreativeBrief com defaults seguros:
   - awareness `solution_aware`, angle `curiosidade`, style `depoimento`,
     emotion `curiosidade`, ctaStyle `soft`, duration `30`
   - hook/rationale vazios (cliente preenche)
   - targetPersonaId/Name da primeira persona
   - `derivedFromBriefId = ultimo_brief.id` pra rastreabilidade
4. `setCreatingNewBrief(draft)` → abre BriefEditModal mode='create'

### 16.5 Handler `handleSaveNewBigVariation`

1. Garante index único (caso conflito com brief criado em paralelo)
2. `persistBriefs([...current, persisted])` → salva no Firestore
3. `setPendingBriefExec(persisted)` → dispara o ConfirmModal de criar
   subprojeto (reusa Porta B / Fase 3.4)
4. Cliente confirma → handleConfirmBriefExec → variant criada →
   navega pra Copy

### 16.6 Commits

```
(pendente)  Fase 5 — Criativo 16+ (botão + handler + warning)
```

---

## 17. Fase 6 — Cortes (Intercut) overhaul

Reformulação completa do IntercutModal (`src/components/IntercutModal.tsx`) e
do endpoint `/api/video/intercut` (`server/routes/video.routes.ts`). O recurso
"cortes pretos" deixou de ser automático (N cortes igualmente distribuídos)
e virou **manual**: o cliente escolhe sentenças da transcrição, define
posição/duração de cada inserção, e as legendas karaoke por palavra são
renderizadas em cima do clip preto.

### 17.1 Fluxo no modal

1. **Auto-analyze ao abrir** — useEffect detecta `open=true` e chama
   `/api/assemblyai/analyze/submit` com o `sourceVideoUrl`. O resultado
   é cacheado em `transcriptCache: Map<videoUrl, transcriptId>` no nível
   do módulo, então re-abrir o modal pro mesmo vídeo é instantâneo.

2. **Polling lightweight** — a cada 3s chama `/analyze/status/:transcriptId`
   até `completed`. Mostra elapsedTime + botão "Cancelar" que dá
   `cancelledRef.current = true` (cleanup do useEffect).

3. **Lista de sentenças** — quando ready, busca
   `/api/assemblyai/transcript/:id/sentences-with-words` que retorna
   `{ sentences: [{ text, start, end, words: [{ text, start, end }] }] }`.
   UI mostra cada sentença com `[+ Adicionar]` que push num array
   `insertions[]`.

4. **Lista de inserções** — cada item tem `atSec`, `durationSec`,
   `position` ('top'|'middle'|'bottom'), `words[]` (snapshot dos words
   da sentença com timestamps absolutos do vídeo).

5. **Controles globais** — `fontSize` (px), `wordsPerLine` (1-8),
   `mergeThresholdSec` (0-2s, default 0.5), `uppercase` (default true),
   `fontFamily` (default "Impact").

6. **Submit** → POST `/api/video/intercut` com payload contendo
   `sourceVideoUrl`, `insertions[]`, e os settings globais.

### 17.2 Backend `/intercut` — merge + render

```
1. downloadFile(sourceVideoUrl)  ← suporta http E /generated/ local (F6.12)
2. Ordena insertions por atSec
3. Fusão de cortes consecutivos (F6.9):
   for cada par consecutivo:
     if next.atSec - (cur.atSec + cur.durationSec) < mergeThresholdSec:
       cur.durationSec = next.end - cur.start
       cur.words.push(...next.words)
       delete next
4. Pra cada bloco mesclado:
   - Gera segmento preto com ffmpeg color=black:s=WxH:d=durationSec
   - Renderiza karaoke ASS via writeAssFileKaraoke (per-group word highlight)
   - Burn-in das legendas com -vf ass=file.ass
5. Concatena: avatar[0:atSec1] + black1 + avatar[end1:atSec2] + black2 + ...
6. persistVideo → local + Firebase (com retry)
7. Responde { videoUrl, durationSec, fromLocal? }
```

### 17.3 `writeAssFileKaraoke` — quebra por sentença

Lógica chave (F6.11):

- Se `wordsPerLine = N`, agrupa words em buckets de N.
- Mas se uma sentença acaba no meio de um bucket (detectado por
  `.`/`!`/`?` no texto da word), força quebra ali — evita "...hoje o
  novo / produto chegou" virar uma linha esquisita.
- Cada bucket vira um event ASS com timing baseado nas timestamps
  reais das words, com per-word `\k<centiseconds>` pra highlight
  estilo karaoke.
- `position` mapeia pra `\an8` (top), `\an5` (middle), `\an2` (bottom).
- `uppercase: true` aplica `.toUpperCase()` nas palavras antes de
  escrever no ASS.
- `fontFamily: "Impact"` no Style line.

### 17.4 AssemblyAI submit + poll pattern (F6.7)

Substituiu o velho `/transcribe` (request bloqueante que poderia rodar
10min e timeout). Novo modelo:

- `POST /api/assemblyai/analyze/submit` — chama AssemblyAI com
  `speech_models: ['universal-2']` (não `speech_model`, deprecated),
  `language_code: 'pt'` (skip auto-detection — economiza ~30%),
  SEM `auto_highlights` (irrelevante pro intercut, custa tempo).
  Suporta `/generated/` paths via `uploadLocalFileToAssemblyAI`
  helper que sobe o arquivo local pro AssemblyAI primeiro.
  Retorna `{ transcriptId }` em <2s.

- `GET /api/assemblyai/analyze/status/:transcriptId` — proxy pro
  AssemblyAI GET /transcript/:id, retorna `{ status, error? }`.

- `GET /api/assemblyai/transcript/:id/sentences-with-words` —
  combina `/sentences` + `/words` do AssemblyAI numa só response
  agrupada por sentença.

### 17.5 Race condition fix (F6.10) — useEffect ressuscitado

Bug originalmente cabuloso: useEffect tinha `analyzing` na dep array.
`setAnalyzing(true)` no início → React agendou re-render → cleanup
disparou → `cancelledRef.current = true` → polling morto antes do
primeiro tick.

Fix: dep array virou `[open, sourceVideoUrl]` (só o que importa pra
re-abrir o modal). E `cancelledRef.current = false` no início do
effect (não no cleanup). Resultado: polling sobrevive ao re-render.

### 17.6 Arquivos modificados

```
src/components/IntercutModal.tsx          redesign completo
server/routes/video.routes.ts             /intercut refactor + merge
server/routes/assemblyai.routes.ts        /analyze/submit + status
                                          + sentences-with-words
                                          + uploadLocalFileToAssemblyAI
server/utils/download.ts                  suporte /generated/ paths
src/pages/EditZapTab.tsx                  handleRenderIntercut signature
                                          updated pra passar settings
```

### 17.7 Commits Fase 6

```
7425f6c  feat — Cortes karaoke + manual insertion (base)
b4c531c  fix — polling com feedback no Cortes
c7ce4e9  perf — análise AssemblyAI ~40-50% mais rápida
49cca44  fix — suporte /generated/ no /analyze/submit
985e437  fix — logs verbose backend
612044b  chore — tsx watch hot reload
171e5d0  fix — logs frontend + erros reais
1662aab  fix — race condition useEffect (cabuloso)
d22c64b  feat — palavras/linha 1-8 + fusão consecutivos
a565381  fix — downloadFile suporta /generated/
8574fbd  feat — caps default + Impact + quebra sentença
```

---

## 18. Fase 7 — Música de fundo

Adiciona seção "Música de Fundo" no EditZapTab (`src/pages/EditZapTab.tsx`),
posicionada **entre** "Galeria de Versões" e "Juntar Gancho + Corpo".
Cliente escolhe um vídeo da galeria, faz upload de MP3 OU gera com
ElevenLabs Music API, ajusta volume/fade, e gera nova versão na galeria.

### 18.1 Componente `MusicSection` (`src/components/MusicSection.tsx`)

UI:

```
┌─────────────────────────────────────────┐
│ 🎵 Música de Fundo                       │
│                                         │
│ Vídeo de destino: [dropdown gallery]    │
│                                         │
│ Fonte: [● Upload MP3]  [○ Gerar com IA] │
│                                         │
│ (Upload mode)                            │
│ [📁 Escolher arquivo (max 25MB)]        │
│                                         │
│ (IA mode)                                │
│ [textarea: prompt]                      │
│ Duração: [slider 10-180s]               │
│ [Gerar música com ElevenLabs]           │
│                                         │
│ <audio controls> preview </audio>       │
│                                         │
│ Volume: [slider 5-100%, default 20%]    │
│ Fade in:  [slider 0-5s, default 1s]     │
│ Fade out: [slider 0-5s, default 2s]     │
│                                         │
│ [🎬 Aplicar música no vídeo]            │
└─────────────────────────────────────────┘
```

### 18.2 Backend ElevenLabs (`server/routes/elevenlabs.routes.ts`)

- `POST /api/elevenlabs/upload-music` — recebe `{ base64, filename }`,
  salva em `/generated/music_<ts>.mp3`, responde `{ url }`.

- `POST /api/elevenlabs/music/generate` — proxy pra
  `https://api.elevenlabs.io/v1/music` com body:
  ```
  { prompt, music_length_ms, force_instrumental: true }
  ```
  Resposta binária → salva local + responde `{ url }`.
  Se 401 `missing_permissions`: traduz pra mensagem amigável
  recomendando Upload como alternativa (F7.3).

### 18.3 Backend video `/add-music` (`server/routes/video.routes.ts`)

```
POST /api/video/add-music
body: { videoUrl, musicUrl, volume?, fadeInSec?, fadeOutSec? }

ffmpeg pipeline:
1. downloadFile(videoUrl) + downloadFile(musicUrl)
2. ffprobe pra pegar duração do vídeo
3. ffmpeg -i video -i music
   -filter_complex
     [1:a]volume=<volume>,
          apad,                              ← se música < vídeo, loop
          atrim=0:<videoDur>,                ← se música > vídeo, corta
          afade=in:st=0:d=<fadeIn>,
          afade=out:st=<videoDur-fadeOut>:d=<fadeOut>
     [music_processed];
     [0:a][music_processed]amix=inputs=2:duration=first:dropout_transition=0
     [aout]
   -map 0:v -map [aout] -c:v copy -c:a aac
   output.mp4
4. persistVideo → versão nova na galeria
```

### 18.4 Arquivos novos/modificados

```
src/components/MusicSection.tsx        NEW (componente completo)
src/pages/EditZapTab.tsx               import + mount entre Galeria
                                       e Juntar Gancho+Corpo
server/routes/elevenlabs.routes.ts     upload-music + music/generate
server/routes/video.routes.ts          /add-music endpoint
```

### 18.5 Commits Fase 7

```
a402815  feat(editzap) — música de fundo (upload + IA)
5d6d4b1  fix(music) — mensagem missing_permissions
```

---

## 19. Bug Fixes recentes (não-feature)

Bugs e melhorias de infra que tocaram código compartilhado. Documento
porque alguns mudam invariantes (memory fallback, retry strategy).

### 19.1 Race condition no polling do ZapCap (F7.0)

`startZapSimplePolling` e `startZapCapPolling` em `src/App.tsx` podiam
disparar fetches concorrentes quando a response demorava mais que o
interval. Resultado: o `setVariants` rodava 4x com o mesmo vídeo
recém-completado → 4 entradas duplicadas na galeria.

**Fix unificado:**

```typescript
let inFlight = false;
const tick = async () => {
  if (inFlight) return; // guard
  inFlight = true;
  try {
    const result = await fetch(...);
    // re-check antes de pushar — pode ter completado entre fetches
    const alreadyCompleted = currentVariants.some(v => v.id === jobId);
    if (alreadyCompleted) return;
    setVariants(...);
  } finally {
    inFlight = false;
  }
};
```

Pattern replicado nos 3 polling loops (zap simple, zap cap, intercut).

### 19.2 Firestore credentials → server crash (F7.5)

`creditsService.hasCredits()` chamado no `/avatar` endpoint quebrava
o processo inteiro quando dev rodava sem service account
("Could not load default credentials" do firebase-admin).

**Fix em `server/services/creditsService.ts`:**

- Flag `firestoreUnavailable: boolean` (latch — uma vez true, fica true).
- `handleFirestoreFailure(operation, err)` — detecta a string de erro
  (credentials / UNAUTHENTICATED / PERMISSION_DENIED / NOT_FOUND) e
  acende a latch + log warning. Outras strings: log error mas não
  latch (pode ser bug real).
- Wrappers try/catch em `ensureAccount`, `getCredits`, `hasCredits`,
  `deductCredits` — todos caem pro `memoryBalance: Map<uid, number>`
  com `WELCOME_CREDITS = 10000` (bumpado de 100 porque cada avatar
  custa 100 → uma geração zerava no dev).

Comportamento: prod com Firestore → ledger real, atômico, com
transactions. Dev sem creds → memory map, reseta no reboot.

### 19.3 Vídeos cinza na galeria — URLs expiradas (F6.13 + F6.14)

ZapCap CDN URLs expiram em ~24h. Recarregar o projeto depois → vídeos
viravam preview cinza não-playable. **Não era novo**, só ficou óbvio
com mais geração.

**Fix duas camadas:**

(a) Detector visual (`src/pages/EditZapTab.tsx` — componente
`VersionVideo` inline no fim do arquivo):

```typescript
<video onError={() => setBroken(true)}>
{broken && (
  <Overlay>
    ⚠️ Vídeo indisponível (URL expirou)
    [Remover da galeria]
  </Overlay>
)}
```

(b) Helper `persistVideo` (`server/utils/persistVideo.ts` — NEW):

```typescript
export async function persistVideo(opts: PersistOptions): Promise<PersistResult> {
  // 1. Salva local em /generated/ primeiro (sempre funciona)
  // 2. Tenta upload Firebase com retry 3x (1s/2s/4s backoff)
  // 3. Se Firebase falhar → fallback /generated/ URL local
  //    (não-durável mas pelo menos não some no meio da sessão)
  return { videoUrl, fromLocal, persisted };
}

export async function downloadAndPersist(sourceUrl, opts) {
  // baixa source, depois chama persistVideo
}
```

Usado em `/intercut`, `/headline`, `/concat`, `/add-music`. Resultado:
mesmo se Firebase Storage estiver flaky, o vídeo aparece imediatamente
local e tenta subir em background.

### 19.4 Persona fill "JSON inválido" (F7.4)

`/api/claude/persona-from-product` com `max_tokens: 1500` cortava a
resposta JSON do Claude no meio de uma string longa → parse fail
→ erro genérico no frontend.

**Fix em `server/routes/claude.routes.ts`:**

- `max_tokens: 1500 → 4000`
- Log warn quando `stop_reason === 'max_tokens'` (sinal de que precisa
  bumpar de novo).
- Erro inclui `stop_reason` no message pro frontend mostrar.

### 19.5 Dark mode "ilegível"

64 ocorrências espalhadas de `dark:text-gray-300 dark:text-gray-600`
(duas classes `dark:text-*` na mesma string — a última ganha por
ordem CSS → todo texto virava gray-600 no dark, invisível).

**Fix:**

- Sed global removendo a duplicação errada.
- Cards coloridos (`bg-gradient-from-amber-50`, etc.) ganharam
  `dark:bg-amber-950/30` + `dark:text-amber-200` pra contraste.

Commits: `0bed712` + `7f7fcbc`.

### 19.6 Credits — chip clicável + grant (F7.6)

Saldo virou link clicável no header (substituiu chip read-only).
Click → prompt "Quantos créditos adicionar?" → POST
`/api/user/credits/grant { amount }` (gated por requireAuth).

Endpoint em `server/routes/user.routes.ts`:

```typescript
POST /api/user/credits/grant
body: { amount: 1-100000 }
→ creditUser(uid, amount, 'dev_grant', { grantedAt })
→ { ok, newBalance, granted }
```

**Não é admin endpoint** — qualquer user autenticado pode dar
créditos pra si mesmo. Em prod isso vira webhook de pagamento ou
admin check real. Por ora resolve o "dev sem créditos" em 2 cliques.

### 19.7 tsx watch — hot reload backend (F6.8)

`package.json` script `dev` virou:

```json
"dev": "tsx watch --clear-screen=false server.ts"
```

Antes: cada edição em `server/*` exigia Ctrl+C + restart manual.
Agora: salva, espera 1s, backend reinicia sozinho. `--clear-screen=false`
preserva logs anteriores no terminal pra debug.

### 19.8 Bumps & invariantes que mudaram

| Constante                         | Antes  | Depois | Razão                                |
| --------------------------------- | ------ | ------ | ------------------------------------ |
| `WELCOME_CREDITS`                 | 100    | 10000  | Avatar custa 100 → 100 = 1 geração   |
| `persona-from-product max_tokens` | 1500   | 4000   | JSON truncava                        |
| AssemblyAI `speech_model`         | string | array  | API mudou pra `speech_models: [...]` |
| ElevenLabs Music                  | n/a    | opt-in | Requer scope `music_generation`      |

---

## 20. Fase 6.15-6.20 — Cortes overhaul (fontes, cores, animação, fundos)

Continuação do trabalho da Fase 6, adicionando customização visual
ampla ao IntercutModal/Cortes sem mexer no que já funcionava.

### 20.1 Controles novos no IntercutModal

| Controle                   | Valores                                                    | Default   |
| -------------------------- | ---------------------------------------------------------- | --------- |
| **Fonte**                  | Impact, Anton, Bebas Neue, Inter Black, Montserrat, Oswald | Impact    |
| **Cor do texto base**      | Color picker hex                                           | `#FFFFFF` |
| **Cor da borda (outline)** | Color picker hex                                           | `#000000` |
| **Cor do destaque**        | Color picker hex                                           | `#9333EA` |
| **Modo de destaque**       | text / background / both / none                            | text      |
| **Animação pop**           | Bool (só pra background/both)                              | off       |
| **Background do corte**    | black / space / gradient                                   | black     |

### 20.2 Bundle de Google Fonts (F6.18)

5 fontes baixadas pra `server/assets/fonts/` (commit `5e04718`):

- `Anton-Regular.ttf`
- `BebasNeue-Regular.ttf`
- `Inter-Black.ttf`
- `Montserrat-Black.ttf`
- `Oswald-Bold.ttf`

ffmpeg subtitles filter usa `fontsdir=server/assets/fonts` pra encontrar
elas independentemente do sistema. Impact continua sendo system-default.

### 20.3 Modo "Fundo" (background) — halo via \bord, não retângulo (F6.20)

Tentativa 1: desenhar retângulo real via `\p1` (ASS path drawing) com
posição calculada por estimativa de largura de palavra. **Falhou** em
texto multi-linha porque estimativa de largura tem muitas variáveis
(line wrap, fonte, alinhamento).

Solução final: **halo `\bord<grosso>\3c<cor>`** aplicado na palavra
ativa dentro do mesmo evento de texto. libass desenha o outline em
volta da letra automaticamente, posição garantida.

Tradeoff: não é retângulo perfeito (segue contorno das letras), mas
**100% alinhado** à palavra falada. É o que ZapCap/TikTok usam.

### 20.4 Pop animation (F6.16)

Anima espessura do `\bord` via `\t(0,120,\bord<peak>)\t(120,250,\bord<base>)`:
começa em 80% do base, sobe pra 115% em 120ms, volta pra 100% em mais 130ms.
Mesma vibe TikTok/CapCut sem custar precisão de posição.

### 20.5 Backgrounds não-preto (F6.19)

- **space** — starfield estático gerado uma vez via `geq=lum='if(lt(random(0),0.0015),255,12)':cb=128:cr=128,gblur=sigma=0.6` em `color=c=0x06091a`. MP4 cacheado em `server/assets/bg-cache/starfield_<W>x<H>.mp4`. Render usa `-stream_loop -1` pra repetir indefinidamente.
- **gradient** — `color=c=0x1a0b3a` + `hue=h=t*30:s=1.2` (rotação de matiz lenta).
- Cache em `server/assets/bg-cache/` (gitignored).

### 20.6 Caveats do starfield

Várias iterações de filtros pra chegar no visual aceitável:

1. ❌ `noise=alls=18:allf=t` (temporal) → cada pixel muda por frame → libx264 não comprime → arquivo de 167MB e ffmpeg trava.
2. ❌ `noise` estático + `zoompan` → ainda 15s pra gerar 5s.
3. ❌ `noise=alls=22` + `eq=contrast=10:brightness=-0.45` → cinza grainy uniforme, sem estrelas.
4. ❌ `geq` com hash linear `mod(X*97+Y*113,4000)` → padrão diagonal regular feio.
5. ✅ `geq=lum=...random(0)<0.0015,255,12...:cb=128:cr=128,gblur=sigma=0.6` → ~1700 estrelas brancas esparsas em fundo escuro.

Honestamente: sutil demais ainda. Pra "vídeo de espaço real" precisa
de upload de MP4 customizado (próxima feature).

---

## 21. Fase 7.3-7.5 — Music library

Biblioteca de músicas salvas no servidor pra cliente reusar trilhas
geradas/upadas em projetos futuros.

### 21.1 Sidecar JSON com metadata (F7.4)

Toda vez que voz/música nova é salva em `/generated/`, escreve um
`.json` paralelo com `{ source, prompt?, lengthMs?, instrumental?,
fileName?, sizeBytes, createdAt }`. Permite reconstruir contexto da
faixa depois (qual prompt, quando, gerada por IA ou uploaded).

### 21.2 Endpoints (F7.3)

- `GET /api/elevenlabs/music/library` — lista todas as faixas em
  `/generated/` matching `music-*` ou `eleven-music-*`, ordenado por
  data desc. Inclui metadata do sidecar quando existe.
- `DELETE /api/elevenlabs/music/:fileName` — apaga MP3 + sidecar com
  path-traversal guard (só aceita pattern dos prefixos legítimos).

### 21.3 UI biblioteca (F7.5)

Bloco colapsável no topo de `MusicSection` com lista de faixas:

- Ícone por source (✨ IA / ⬆ upload)
- Prompt original ou nome do arquivo
- Data relativa (`2h atrás`)
- Tamanho em bytes
- Mini audio player
- Botão "Usar esta" → seleciona como background
- Botão Lixeira → apaga (com confirm)
- Auto-refresh após upload/geração nova

### 21.4 Fix bonus

`/upload-music` estava montado em `elevenLabsPremiumRouter` (path
`/api/elevenlabs-premium/upload-music`) mas o frontend chamava
`/api/elevenlabs/upload-music`. Upload nunca funcionou. Movido pro
router correto (`elevenLabsRouter`).

---

## 22. Fase 8 — Dev supervisor (auto-restart)

Wrapper Node simples (`scripts/dev-supervisor.mjs`) que respawna
`tsx server.ts` se morrer.

### 22.1 Por que

Backend morria silenciosamente em dev por:

- macOS App Nap matando processos ociosos
- Terminal pai fechando
- SIGTERM de outras coisas no sistema
- OOM ocasional em uploads grandes

Cliente via `ERR_CONNECTION_REFUSED` e tinha que pedir restart manual.

### 22.2 Como funciona

- `npm run dev` → `node scripts/dev-supervisor.mjs`
- Supervisor spawna `tsx server.ts`, herda stdio
- Detecta exit do child → reinicia em 2s
- Limita a 5 reinícios em 60s pra não loop infinito quando bug é código
- Respeita SIGINT/SIGTERM pra encerrar graciosamente

### 22.3 Escapes pra debug

- `npm run dev:bare` → tsx puro sem supervisor (vê stack trace cheia)
- `npm run dev:watch` → tsx watch (hot reload backend, raramente útil agora)

### 22.4 Detached mode

Pra evitar que o supervisor morra junto com a tab do Claude Code que
o iniciou, comando padrão de start é:

```
nohup npm run dev > /tmp/metavise-dev.log 2>&1 & disown
```

Resultado: processo com PPID 1 (init/launchd), sobrevive a tudo
exceto kill explícito ou reboot.

---

## 23. Fase 9 — Avatar segmentado HeyGen (WIP — quality issues)

Tentativa de gerar HeyGen apenas nos trechos visíveis em vez do vídeo
inteiro, pra economizar ~75% do custo HeyGen em vídeos com Cortes/b-rolls.

**Status atual:** pipeline funciona end-to-end mas qualidade ruim.
Cliente quer pausar aqui e voltar depois.

### 23.1 Como funciona (pipeline completa)

```
1. Cliente abre modal "💰 Modo Econômico" na AvatarTab
2. AssemblyAI transcreve o áudio (mesmo padrão de Cortes — auto-detect lang)
3. Cliente clica "+" nas frases onde quer avatar visível
4. Frases consecutivas (gap<0.5s) fundidas em 1 segment
5. Backend cuts audio em N pedaços MP3 (libmp3lame, accurate_seek)
6. Cada chunk sobe pra Firebase Storage (ou catbox.moe fallback)
7. POST /v2/video/generate × N em paralelo (max 3)
8. Polling com fallback v2 → v1 (alguns video_ids só batem em v1)
9. Cada chunk completo → baixa MP4
10. ffmpeg stitch: avatar_0 + gap_preto+áudio + avatar_1 + ... → final
11. Resultado em /generated/segjob_<id>_final.mp4
```

### 23.2 Endpoints + arquivos

| Arquivo                                                                  | O que faz                                                   |
| ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `server/utils/audio.ts`                                                  | cutAudioSegment + probe + validate + timeline               |
| `server/services/heygenSegmentedJob.ts`                                  | Orquestrador do job (cut → upload → submit → poll → stitch) |
| `server/routes/heygen.routes.ts` POST `/generate-segmented`              | Cria job, deduz créditos pro-rata                           |
| `server/routes/heygen.routes.ts` GET `/generate-segmented/status/:jobId` | Polling do progresso                                        |
| `src/components/SegmentedAvatarModal.tsx`                                | UI com transcrição AssemblyAI + lista frases + "+"          |
| `src/pages/AvatarTab.tsx`                                                | Botão verde "💰 Modo Econômico"                             |

### 23.3 Known issues (motivo do WIP)

**A. Voz muda quando avatar aparece**

HeyGen recebe o chunk de áudio mas parece processar como
"audio + fallback voice" — voiceover muda no trecho do avatar e
volta pra original nos gaps. Provavelmente HeyGen não confia no
audio_url quando chunk é curto/cortado mid-conteúdo.

**B. Avatar congela após 1s**

Avatar anima por ~1s e depois trava no último frame até a duração
total. HeyGen aceita o job, processa, mas só renderiza 1s de
movimento. Lip-sync também ruim no 1s que anima.

**Hipóteses pra solução futura:**

1. **Chunks bem maiores** (30s+) — perde a economia mas HeyGen pode
   confiar mais em clips longos.
2. **Contatar suporte HeyGen** — pode ter formato/parameter específico
   que evita esse comportamento.
3. **Trocar provider** — D-ID, Synthesia, ou Sieve podem lidar melhor
   com chunks mid-conteúdo.
4. **Pre-process audio** — adicionar 200ms de silêncio antes/depois
   do chunk pra dar respiro nos boundaries.

### 23.4 Decisões técnicas relevantes (pra retomar depois)

- **MP3 (libmp3lame) não AAC**: AAC com seek imperfeito (sem
  `-accurate_seek`) tava gerando chunks de 0 bytes, output cmd code 234.
  MP3 com `-ss APÓS -i + -accurate_seek` é o pattern testado que funciona.
- **catbox.moe fallback**: Firebase Storage write requer service
  account em prod. Em dev local, fallback automático pra catbox.moe
  (anônimo, sem signup, online há anos). 0x0.st era opção mas
  desabilitou uploads em 2026 por causa de bot spam.
- **Polling v1 fallback**: HeyGen `/v2/video/{id}` retorna 404 pra
  alguns video_ids; precisa fallback pra `/v1/video_status.get?video_id=`.
  Causou o primeiro bug "job pendurado 15min sem completar mesmo com
  vídeo pronto no HeyGen". Código existente do `/api/heygen/status/:id`
  já fazia isso, esqueci de copiar.
- **Cost model**: cobra créditos pro-rata `max(20, round(100 * totalAvatarSec / 60))`.
  Min 20 cr cobre overhead.
- **Job tracking in-memory**: Map<jobId, SegmentedJob> com cleanup 24h.
  Não persiste — restart de server perde jobs em vôo.

### 23.5 P1 — Auto-detect language no Cortes também

Aplicado mesmo padrão do SegmentedAvatarModal no IntercutModal
(commit `98b0681`):

- Cortes default era `pt` hardcoded → áudio EN gerava frases inventadas em PT
- Agora dropdown Auto/PT/EN/ES, default Auto
- Cache por (videoUrl + lang) pra não servir transcript lixo cacheado

---

## 24. Tags de checkpoint (pra rollback)

| Tag                                  | Estado                                                            |
| ------------------------------------ | ----------------------------------------------------------------- |
| `checkpoint-pre-blueprint` (ec471f5) | Antes do Blueprint feature inteira                                |
| `checkpoint-pre-heygen-segments`     | Antes do work de avatar segmentado (Cortes/Music/Fontes estáveis) |
| `checkpoint-segmented-avatar-wip`    | Avatar segmentado funcional mas com quality issues                |

Comandos:

```
git tag -l "checkpoint-*"
git reset --hard checkpoint-pre-heygen-segments  # volta pra antes do avatar segmentado
```

---

## 25. Commits index (Sessão pós-Fase 7)

```
98b0681  feat(intercut) — auto-detect lang + dropdown
7d3dfad  feat(heygen) — avatar segmentado (WIP)
5e04718  feat(cortes) — controles fonte/cor/destaque/background
6bbcb18  feat(music) — biblioteca de músicas + fix upload-music
c051b0a  feat(dev) — supervisor auto-restart
2fd2013  docs(blueprint) — Fases 6 e 7 + bug fixes
33e87a7  feat(credits) — chip clicável + grant
e3f4d9a  fix(credits) — Firestore credentials catch
```

---

_Last updated: end of P1 (auto-detect language Cortes). Avatar
segmentado WIP — voltar quando solução de quality estiver clara.
Próximas opções: stripe pagamentos, Pexels API pra background
videos reais, polish (loading skeletons, console noise), seleção
de áudio file customizado pra Cortes (não só vídeo). Tag de
rollback: `checkpoint-segmented-avatar-wip`._

---

# 26. UX Round (UX1–UX22) — sessão grande de polimento

22 commits trabalhando na qualidade do produto e clareza de UX.
Cada um isolado, fácil de reverter individual.

## 26.1 Wizard nav, autosave, popups (UX1–UX3)

- **UX1** Setas L/R + scroll roda no wizard nav. Setas escondem nas pontas.
- **UX2** Removido chip "Salvo há X min". Toast de auto-save silenciado
  (só dispara em "Salvar" manual).
- **UX3** Popup falso "Criar subprojeto?" aparecia em variant já existente.
  Causa: auto-save reescrevia variant sem `brief`. Fix: 3ª condição
  no lookup + preserva brief/status/name no save.

## 26.2 Brief context downstream (UX4, UX7)

- **UX4** HookChooser consome productInfo+persona+brief — hooks
  aderentes ao ângulo, não só ao texto.
- **UX7** Plano de Marketing ganhou checklist vertical (1 linha/brief,
  tick ✓ pros executados, mini progress bar). Voz/Avatar recebem
  `brief` — `AIRecommendationPanel` enriquece prompt + mostra
  "Otimizado pra Criativo X" no header.

## 26.3 Data leak + popup fixes (UX5, UX6, UX8)

- **UX5** "Dados do Projeto" colapsa por padrão. Chips resumo (X personas,
  Y briefs) no header.
- **UX6** Audios/videos da variant anterior vazavam no novo subprojeto.
  Fix: zerar top-level state em handleConfirmBrief/PersonaExec.
- **UX8** Mesmo bug pra `handleCreateProject`. Reset comprehensive.
  Bonus: "Preencher com fonte" → "Preencha automaticamente".

## 26.4 Otimizador + Hook (UX9, UX10, UX12, UX17)

- **UX9** Otimizador ElevenLabs estava ADICIONANDO texto. Prompt
  reforçado + safety net no código.
- **UX10** Hooks vinham com placeholders `___`. Agora chooseHooksFromCopy
  retorna template+filled. UI mostra filled como principal.
- **UX12** Rodapé Copy unificado em 1 botão "Ir para Copy do Gancho".
- **UX17** **Hook Lab** — gera 9 hooks 100% originais (sem bíblia) via
  5 fórmulas comprovadas.

## 26.5 UI polish (UX11, UX21)

- **UX11** Select dark mode branco-no-branco. Fix global em 15 inputs
  (CopyTab, AvatarTab, HookVisualGenerator, ElevenLabsConfigModal).
  Bonus: pergunta "Estoque limitado?" removida.
- **UX21** Setas wizard nav apareciam tarde. Threshold 0px + poll
  durante smooth scroll + bg azul Metavise pra visibilidade.

## 26.6 Content Risk Scanner (UX13)

**Sistema completo** detecção termos arriscados em copy/hook.

- 6 categorias × 3 severidades (critical/high/medium)
- ~120 termos em `src/data/contentRiskTerms.ts` (medication,
  celebrity, discrimination, comparative_claim, reach_reducing,
  medical_claim)
- Banner: 3 ações ("Reescrever versão segura" / "Manter assim" /
  "Editar manualmente"). Ack persiste por hash do texto.
- Integrado em CopyTab + HookChooser.

## 26.7 Self-critique + Variants A/B (UX15)

- **Self-critique:** "Revisar com IA" — Claude pontua 6 dimensões
  (specificity, hookStrength, oralCadence, emotionalPull,
  modestCredibility, mechanismClarity). Reescreve se algum < 8.
- **Variants A/B:** "Gerar 2 versões" roda 2 chamadas em paralelo.
  Picker side-by-side.

## 26.8 Beat-by-Beat Editor (UX16)

- Script gerado com markers `[BEAT]` parseado em cards editáveis
- Cada beat tem botão "Regerar este beat" — `regenerateBeat()`
  preserva flow com adjacentes
- Toggle "Beat-by-Beat / Texto Único" no UI

## 26.9 Biblioteca de Copies (UX14, UX18, UX19, UX20, UX22)

**A grande feature.** Few-shot prompting com biblioteca pessoal.

- **UX14** Few-shot em generateAdCopyWithClaude:
  - `src/data/copyLibrary.ts` — algoritmo + `selectCopyExamples`
  - Cultural PT-BR mode (só ativa quando lingua = português)
  - `inferVertical` mapeia produto → vertical
- **UX18** Biblioteca pessoal Firestore:
  - `users/{uid}/copyLibrary/{copyId}`
  - `src/lib/personalCopyLibrary.ts` — CRUD wrapping Firestore
  - `src/components/CopyLibraryModal.tsx` — modal Minhas + Metavise
  - Botão "✓ Marcar como copy boa" auto-adiciona
- **UX19** Esvaziada COPY_LIBRARY sistema (eu tinha criado 25
  sintéticas; user vai curar reais).
- **UX20** Form SIMPLIFICADO — só `name?` + `script`. IA classifica
  resto via `analyzeCopyForLibrary` (vertical/awareness/idioma/
  angle/whyItWorks). Botão movido pra perto do "Gerar Copy".
- **UX22** **Seleção MANUAL** — checkbox em cada copy. Marca quais
  IA deve usar de referência. Banner azul com contagem; cinza quando
  0 (auto-seleção). Persiste em `config.copy.referenceCopyIds[]`.
  Quando user seleciona, `__manualSelection=true` → usa todas
  (count = min(5, lib.length)).

## 26.10 Firestore Rules + setup

- `firestore.rules` ganhou bloco `users/{uid}/copyLibrary` (allow
  read/write se isOwner || isAdmin)
- **Rules são deployadas MANUALMENTE** (sem firebase CLI)
- Firebase project: `educacaopelotrabalho2025` (display name "Metavise")
- Database: **`ai-studio-3e28f82f-52dc-4e0b-a786-5f9a5b893a4f`**
  (NÃO É default)
- Console PT-BR: aba "Rules" → **"Segurança"**

## 26.11 Commits UX1–UX22

```
68f4778  feat(library)   — UX22 seleção manual de referências
834cffe  fix(ux)         — UX21 setas wizard nav visíveis
2347169  fix(rules)      — Firestore rules pra copyLibrary
1c6d2c4  feat(library)   — UX20 upload simplificado + IA classifica
80f633c  feat(library)   — UX19 esvazia COPY_LIBRARY + form manual
8a587f1  feat(library)   — UX18 Minha Biblioteca (Firestore CRUD)
602973c  feat(hook)      — UX17 Hook Lab original
4ee6833  feat(copy)      — UX16 beat-by-beat editor
0242094  feat(copy)      — UX15 self-critique + variants A/B
5ce4649  feat(copy)      — UX14 biblioteca + few-shot + cultural PT
37ab66d  feat(safety)    — UX13 content risk scanner
078578c  feat(copy)      — UX12 1 botão "Ir para Copy do Gancho"
d7bc2bd  fix(copy)       — UX11 select dark + remove estoque
f1a6fc0  feat(hook)      — UX10 hooks pré-preenchidos
6bc25ad  fix(voz)        — UX9 otimizador não adiciona texto
086949a  fix(projeto)    — UX8 reset em handleCreateProject
ddd8575  feat(plano)     — UX7 checklist + brief em voz/avatar
0c873f2  fix(subprojeto) — UX6 fix audios/videos leak
36a605a  feat(projetos)  — UX5 colapsa Dados do Projeto
9e4f501  feat(hook)      — UX4 Copy do Gancho com persona+brief
68754c6  feat(ux)        — UX1-3 wizard nav + autosave + subprojeto fix
```

## 26.12 Status final + próximos passos

**Funcionando bem:**

- Geração de copy com few-shot + cultural PT-BR (UX14)
- Biblioteca pessoal com seleção manual de refs (UX22)
- Content risk scanner 6 categorias (UX13)
- Hook Lab + bíblia preenchida (UX10, UX17)
- Beat-by-beat editor (UX16)
- Self-critique e variants A/B (UX15)

**Pendências conhecidas:**

- **COPY_LIBRARY (sistema) está VAZIA** — user vai curar copies reais
  depois e adicionar manualmente em `src/data/copyLibrary.ts`
- **Avatar segmentado** continua WIP (voice mismatch + freeze
  após 1s). Tag rollback existe.
- **Rules publicadas no Firebase Console** — sem CLI configurado.
  User já publicou as rules do UX18 (subcollection copyLibrary).

**Setup Firebase atual:**

- Project ID: `educacaopelotrabalho2025`
- Database: `ai-studio-3e28f82f-52dc-4e0b-a786-5f9a5b893a4f`
- Plano: Blaze (pago por uso)
- ~100k reads/100k writes/dia (auto-save é o maior consumidor)

**Próximas features possíveis (em ordem de prioridade sugerida):**

1. **Publicar rules pra confirmar UX18+UX20 funcionando 100%** (user
   diz que já publicou — verificar adicionando uma copy via form)
2. **Curar biblioteca sistema** com copies reais quando user tiver
3. **Stripe pagamentos** (créditos hoje são manual via prompt JS)
4. **Pexels API** pra backgrounds reais nos Cortes
5. **Console noise cleanup** (logs de debug)
6. **Loading skeletons** em mais lugares
7. **Avatar segmentado** voltar quando provider melhor disponível

_Last updated: UX22 (seleção manual referências). 22 commits, working
tree limpo. Pronto pra compactar o chat._
