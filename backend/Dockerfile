FROM node:20-bookworm

WORKDIR /app

# Instalar dependencias del sistema (ffmpeg + python para yt-dlp)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Instalar yt-dlp (--break-system-packages requerido en Debian 12+)
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp

# Copiar package.json e instalar dependencias de Node
COPY package*.json ./
RUN npm install --omit=dev

# Copiar el resto del código
COPY . .

# Crear carpetas que el server espera
RUN mkdir -p tmp data

EXPOSE 10000

CMD ["node", "server.js"]