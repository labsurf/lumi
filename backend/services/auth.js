import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CLIENT_FILE = path.resolve(__dirname, '..', process.env.GOOGLE_OAUTH_CLIENT);
const clientData = JSON.parse(fs.readFileSync(CLIENT_FILE, 'utf8')).web;

export const oauth2Client = new google.auth.OAuth2(
  clientData.client_id,
  clientData.client_secret,
  'http://localhost:3000/oauth2callback'
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

// Forzar que refresque el access token automáticamente cuando expire
oauth2Client.on('tokens', (tokens) => {
  if (tokens.refresh_token) {
    // (Solo por si Google rota el refresh token)
    console.log('🔄 Nuevo refresh token recibido:', tokens.refresh_token);
  }
});

export const drive = google.drive({ version: 'v3', auth: oauth2Client });