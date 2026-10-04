FROM node:20-bookworm

WORKDIR /app

# ── Dependencias del sistema ──────────────────────────
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# ── Deno (runtime de JS para resolver desafíos de YouTube) ──
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh
ENV PATH="/usr/local/bin:${PATH}"

# ── yt-dlp nightly (necesario: el stable se queda atrás en días) ──
RUN pip3 install --no-cache-dir --break-system-packages -U --pre "yt-dlp[default]"

# ── Dependencias de Node ──────────────────────────────
COPY package*.json ./
RUN npm install --omit=dev

# ── Código ────────────────────────────────────────────
COPY . .

RUN mkdir -p tmp data

EXPOSE 10000

CMD ["node", "server.js"]