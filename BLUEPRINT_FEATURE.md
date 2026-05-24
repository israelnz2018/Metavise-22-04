# Metavise — Blueprint Feature (Context & Status)

> **Audience:** future Claude sessions (or the user) picking up this work
> after a context reset. This file is the source of truth for everything
> we decided about the "VSL → 15 creatives" feature. **Read this first.**

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
acac931  Fase 4 — Dados do Projeto + Porta A (persona)
74d51c3  Fase 4 — entry point com escolha VSL vs Produto
7a4cce3  Phase 3.x docs — BLUEPRINT_FEATURE.md context handoff
769f43f  Phase 3.5 — CopyTab active brief banner
(3.4)    Phase 3.3 + 3.4 — BriefEditModal + create-subprojeto popup
(3.2)    Phase 3.2 — briefs grid
(3.1)    Phase 3.1 — PlanTab v2 header
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

_Last updated: end of Fase 5 (Criativo 16+ via BriefEditModal mode='create').
Próximos passos sugeridos: testar end-to-end, polish na UI da seção
Dados do Projeto, ou novas features (ex: filtros no grid de briefs)._
