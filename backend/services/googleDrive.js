import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

const SCOPES = ['https://www.googleapis.com/auth/drive'];

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT,
  scopes: SCOPES,
});

const drive = google.drive({ version: 'v3', auth });

// Subir un archivo de audio a Drive
export async function uploadAudio(filePath, fileName, mimeType = 'audio/mpeg') {
  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
    },
    media: { mimeType, body: fs.createReadStream(filePath) },
    fields: 'id, name, webContentLink',
  });
  return res.data;
}

// Listar canciones del folder
export async function listTracks() {
  const res = await drive.files.list({
    q: `'${process.env.GOOGLE_DRIVE_FOLDER_ID}' in parents and trashed=false`,
    fields: 'files(id, name, mimeType, size, createdTime)',
    orderBy: 'createdTime desc',
  });
  return res.data.files;
}

// Obtener stream (para proxy)
export async function getFileStream(fileId, range) {
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream', headers: range ? { Range: range } : {} }
  );
  return res;
}

export async function deleteTrack(fileId) {
  await drive.files.delete({ fileId });
}