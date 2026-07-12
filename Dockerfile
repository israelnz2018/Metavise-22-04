# Render na nuvem (Cloud Run): roda o MESMO app (SPA + API + pipeline ffmpeg)
# numa máquina de 8 vCPU. Nada "key" muda — é só ONDE o ffmpeg roda.
# ffmpeg vem do pacote ffmpeg-static (baixado no npm ci pro binário Linux),
# então não precisa instalar ffmpeg no sistema.
FROM node:24-bookworm-slim

WORKDIR /app

# ffmpeg COMPLETO do Debian (o do ffmpeg-static Linux não traz lavfi, usado no
# fundo base de todo render). Apontamos o fluent-ffmpeg pra ele via env.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe

# 1) Dependências (cacheável). npm ci baixa o ffmpeg-static do Linux.
COPY package.json package-lock.json ./
RUN npm ci

# 2) Código + build do frontend (Vite → dist/).
COPY . .
RUN npm run build

# 3) Produção: serve dist/ + API. Cloud Run injeta PORT (8080); o server lê
#    process.env.PORT e escuta em 0.0.0.0.
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npx", "tsx", "server.ts"]
