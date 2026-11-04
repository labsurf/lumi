FROM node:20-bookworm

WORKDIR /app

# ── Dependencias del sistema ──────────────────────────
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    unzip \
    git \
    && rm -rf /var/lib/apt/lists/*

# ── Deno (runtime de JS para resolver desafíos de YouTube) ──
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh
ENV PATH="/usr/local/bin:${PATH}"

# ── yt-dlp nightly + Plugin POT ──
RUN pip3 install --no-cache-dir --break-system-packages -U --pre "yt-dlp[default]" "bgutil-ytdlp-pot-provider"

# ── Servidor POT (Node.js) ──
# Clonamos el repositorio oficial y lo compilamos
RUN git clone --single-branch --branch master https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /app/bgutil-pot
WORKDIR /app/bgutil-pot/server/
RUN npm install && npx tsc
WORKDIR /app

# ── Dependencias de tu aplicación Node ────────────────
COPY package*.json ./
RUN npm install --omit=dev

# ── Código de tu aplicación ───────────────────────────
COPY . .

RUN mkdir -p tmp data

# ── Script de arranque ────────────────────────────────
# Inicia el servidor POT en segundo plano y luego tu app
RUN echo '#!/bin/sh\n\
node /app/bgutil-pot/server/build/main.js &\n\
node server.js' > /app/start.sh && chmod +x /app/start.sh

EXPOSE 10000

CMD ["/app/start.sh"]