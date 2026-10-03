FROM node:20-bullseye

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir yt-dlp

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p tmp data

EXPOSE 10000

CMD ["node", "server.js"]