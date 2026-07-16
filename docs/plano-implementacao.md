# Plano de Implementação — Reorganizar o app + Remotion

> Consolidação das decisões (conversa 29–30/05/2026).
> **Princípio inegociável: NÃO deletar nada que já existe.** Só reorganizar e
> acrescentar. Migração **incremental**, convivendo com o legado.
> Legenda: ✅ feito · 🔲 a fazer · 🟡 decisão pendente · `[novo]` `[reorg]` `[manter]`

---

## Fase 0 — Fundação (modelo de dados — incremental, por baixo)

- 🔲 `[reorg]` 3 níveis: **Conta/Marca** · **Projeto (estratégia)** · **Criativo (execução)**
- 🔲 `[novo]` Conceito único de **Asset** por parte `{ parte, tipo, fonte, url, storagePath, criado em }`
- 🔲 `[reorg]` Estratégia mora no **projeto** (não se duplica nas variantes)
- 🔲 `[novo]` Regra **"1 de cada por subprojeto"** → aposenta `audios[]` / `videos[]` como listas
- 🔲 `[reorg]` Migrar campos do `AdConfig` **aos poucos**, sem quebrar o que lê `config.copy.*`

## Fase 1 — Acesso / Onboarding

- 🔲 `[novo]` Pedir **Marca** no 1º login/projeto — **pulável** (não obrigatório)
- ✅ `[novo]` Modal de marca (hoje em localStorage) → 🔲 migrar pro **perfil da conta** (Firestore)

## Fase 2 — Meus Projetos (reorganizar a aba)

- 🔲 `[novo]` Bloco **🏢 Dados da Empresa** no topo (sempre editável)
- 🔲 `[reorg]` Árvore: **Projeto › Estratégia › Criativos › (hook/corpo/cta) › assets › vídeos**
- 🔲 `[novo]` Criar projeto escolhendo **"Plano" ou "Avulso"**
  - **Mesma estrutura na aba** nos dois casos (Projeto › Criativos). Diferença = só a semente:
    **Plano** nasce com os 15 briefs · **Avulso** começa vazio (rótulo "Avulso") e o usuário adiciona criativos.
  - **Avulso NÃO limita quantidade** — pode ter vários subprojetos também.
- 🔲 `[reorg]` Dobrar os tipos antigos (`complete/copy/video/editing`) dentro de Plano/Avulso — **sem apagar**

## Fase 3 — Estratégia (Fonte → Persona → Plano)

- 🔲 `[reorg]` Cada página **reabre 100% preenchida** (estado completo, não só o resultado)
- 🔲 `[reorg]` Editar estratégia = **atualiza o projeto no lugar** (NÃO cria subprojeto)
- 🔲 `[reorg]` Criativos já criados ficam **congelados** (snapshot) ao mudar estratégia
- ✅ `[manter]` Plano gera os ~15 briefs (já existe)

## Fase 4 — Ponte Plano → Produção (recomendação)

- 🔲 `[novo]` `recomendarTemplate(brief)`: mapeia `style` → template/método
- 🔲 `[novo]` Abrir criativo do plano já vem com **template + hook pré-preenchidos**

## Fase 5 — Produção do Criativo (subprojeto)

- 🔲 `[reorg]` **Brief no topo**; tudo abaixo (copy, áudio, avatar, edição, vídeos)
- 🔲 `[novo]` **3 partes: hook · corpo · cta** (hoje são 2 → acrescentar CTA)
- 🔲 `[novo]` Por parte, **fonte**: escrever / **gerar (HeyGen + ElevenLabs)** / upload / puxar do projeto
- 🔲 `[reorg]` Trazer **Avatar e Voz pra dentro do bloco** (reusa o backend existente)
- 🔲 `[novo]` Guarda ao regenerar asset: **"Substituir ou Salvar como novo subprojeto"**
- 🔲 `[novo]` **Vídeo cru** e **vídeo editado** mostrados **separados**
- 🔲 `[novo]` Guard: produção exige **Projeto + Criativo** (seletor amigável, não erro)

## Fase 6 — Remotion (acabamento por parte)

- ✅ `[novo]` Aba Remotion (entre Voz e Avatar) + 14 templates + prévia (Player) + ajustes
- 🔲 `[reorg]` Quebrar os 14 templates em **estilos por parte** (hook/corpo/cta)
- 🟡 `[decisão]` Manter os 14 inteiros como **"modo expresso"**? (a decidir)
- 🔲 `[novo]` **"Incluir Remotion" por parte** → mostra só aquela parte
- 🔲 `[novo]` **Legenda automática real** (captions + whisper) no render

> ⛔ **PENDENTE DE DEFINIÇÃO — não implementar ainda:** os caminhos de **edição**.
> Sabe-se que a **Edição Zap** terá **3 botões** (hook · corpo · **CTA**) em vez de 2,
> e clicar numa parte mostrará **os tipos de edição** disponíveis — um deles o **Remotion**.
> Definir os caminhos de edição antes de tocar nessas abas.

## Fase 7 — Montagem & Saída

- 🔲 `[reorg]` Montar de 2 jeitos: **Template (Remotion)** ou **Juntar direto (`/concat` já existe)**
- 🔲 `[novo]` Ajustes na montagem: transição / música / legenda / formato (9:16 padrão)
- ✅ `[manter]` Legenda no caminho "cru" via **ZapCap** (já existe)
- 🔲 `[novo]` **"Gerar" de verdade**: local agora → **nuvem (Remotion Lambda)** depois
- 🔲 `[novo]` Licença Remotion (chave) **só na hora da nuvem** — vai no `.env`

## Fase 8 — Armazenamento / Retenção

- 🔲 `[novo]` Reter: **projeto/textos = sempre** · **mídia crua = 30 dias** · **mídia final = 60 dias**
- 🔲 `[novo]` Aviso **"expira em X dias"** + botão **"Baixar tudo"**
- 🔲 `[novo]` Limpeza automática + **monitorar volume no 1º mês** pra calibrar

---

## Resumo do que NÃO muda (fica intacto)

- Todas as abas e fluxos atuais (Source/Persona/Plan/Copy/Voz/Avatar/Edição/Final)
- HeyGen, ElevenLabs, Runway, ZapCap, `/concat`, jobStore, storage
- Os 4 tipos de projeto (continuam funcionando; só ganham um "guarda-chuva" Plano/Avulso)
