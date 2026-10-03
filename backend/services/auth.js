import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Obtiene las credenciales de Google OAuth2 con 2 estrategias:
 *   1. Archivo local `credentials/oauth-client.json` (desarrollo)
 *   2. Variables de entorno GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (producción)
 */
function getClientCredentials() {
  // Estrategia 1: archivo JSON local
  const clientFile = process.env.GOOGLE_OAUTH_CLIENT
    ? path.resolve(__dirname, '..', process.env.GOOGLE_OAUTH_CLIENT)
    : null;

  if (clientFile && fs.existsSync(clientFile)) {
    console.log('🔑 Credenciales OAuth desde archivo local');
    const data = JSON.parse(fs.readFileSync(clientFile, 'utf8'));
    const client = data.web || data.installed;
    return {
      client_id: client.client_id,
      client_secret: client.client_secret,
    };
  }

  // Estrategia 2: variables de entorno (Render, producción)
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    console.log('🔑 Credenciales OAuth desde variables de entorno');
    return {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }

  throw new Error(
    'No hay credenciales OAuth. Define GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET ' +
    'o provee un archivo en GOOGLE_OAUTH_CLIENT.'
  );
}

const { client_id, client_secret } = getClientCredentials();

export const oauth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  'http://localhost:3000/oauth2callback'
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

oauth2Client.on('tokens', (tokens) => {
  if (tokens.refresh_token) {
    console.log('🔄 Nuevo refresh token recibido:', tokens.refresh_token);
  }
});

export const drive = google.drive({ version: 'v3', auth: oauth2Client });