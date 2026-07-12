# Render na nuvem — Cloud Run (passo a passo)

Roda o app inteiro (SPA + API + ffmpeg) numa máquina de **8 vCPU** no seu
próprio projeto Firebase/Google Cloud (`educacaopelotrabalho2025`). O render sai
do seu laptop e fica ~2–3× mais rápido, sem congelar sua máquina. **Nada "key"
muda** — copy, firewall, personas, tudo igual; é só onde o ffmpeg roda.

Custo: ~US$0,04 por render, ~120 renders/mês grátis (franquia), US$0 parado.

---

## Passo 1 — Instalar o gcloud (uma vez)

macOS (Homebrew):
```
brew install --cask google-cloud-sdk
```
Ou baixe em https://cloud.google.com/sdk/docs/install

Depois faça login e escolha o projeto:
```
gcloud auth login
gcloud config set project educacaopelotrabalho2025
```

## Passo 2 — Ligar as APIs necessárias (uma vez)
```
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

## Passo 3 — Deploy

Rode isto na raiz do projeto. Ele constrói a imagem (usando o `Dockerfile`) e
sobe. Troque os valores `SUA_CHAVE_...` pelas suas chaves reais (as mesmas dos
arquivos `*-config.json` locais ou do seu `.env`):

```
gcloud run deploy metavise \
  --source . \
  --region southamerica-east1 \
  --cpu 8 \
  --memory 16Gi \
  --cpu-boost \
  --timeout 3600 \
  --concurrency 8 \
  --min-instances 0 \
  --max-instances 2 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production \
  --set-env-vars CLAUDE_API_KEY=SUA_CHAVE_CLAUDE \
  --set-env-vars ELEVENLABS_API_KEY=SUA_CHAVE_ELEVENLABS \
  --set-env-vars HEYGEN_API_KEY=SUA_CHAVE_HEYGEN \
  --set-env-vars PEXELS_API_KEY=SUA_CHAVE_PEXELS \
  --set-env-vars ASSEMBLYAI_API_KEY=SUA_CHAVE_ASSEMBLYAI \
  --set-env-vars ZAPCAP_API_KEY=SUA_CHAVE_ZAPCAP
```

Opcionais (se usar): `GEMINI_API_KEY`, `RUNWAY_API_KEY`.

> Região: `southamerica-east1` (São Paulo) = menor latência pra você.
> `us-central1` é um pouco mais barata, se preferir.

No fim ele mostra a **Service URL** (algo como
`https://metavise-xxxx.a.run.app`). É por ela que você vai usar o app.

## Passo 4 — Deixar o login do Firebase funcionar na URL nova
No console do Firebase → **Authentication → Settings → Authorized domains** →
**Add domain** → cole o domínio da Service URL (ex.: `metavise-xxxx.a.run.app`).
Sem isso, o login não abre na URL da nuvem.

## Passo 5 — Usar
Abra a **Service URL** no navegador, faça login normal, e monte. O render agora
roda nos 8 núcleos da nuvem. Seu laptop fica livre.

---

## Segurança (importante)
Os endpoints que gastam (IA/render) exigem o **login do Firebase** que o app já
manda — então a URL pública **não** vira um serviço de render aberto pra
estranhos. O `--max-instances 2` ainda limita o gasto máximo por garantia.

**Válvula de escape:** se algo de auth travar na nuvem, redeploy com
`--set-env-vars AUTH_DISABLED=1` (reabre os endpoints; mantenha o
`--max-instances` baixo pra limitar custo enquanto investigamos).

## Atualizar depois de mudar código
Rode o mesmo `gcloud run deploy ... --source .` de novo — ele reconstrói e
troca a versão sem downtime.

## Ver logs / custo
- Logs: `gcloud run services logs read metavise --region southamerica-east1`
- Custo: Console → Billing → Reports (filtra por Cloud Run).
