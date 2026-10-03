import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

window.NativeFilesystem = Filesystem;
window.NativeShare = Share;
window.NativeDirectory = Directory;

import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';

const sqlite = new SQLiteConnection(CapacitorSQLite);
let db;

async function initializeDatabase() {
  try {
    db = await sqlite.createConnection('mcclure_logs', false, 'no-encryption', 1, false);
    await db.open();

    await db.execute(`
      CREATE TABLE IF NOT EXISTS route_stops (
        id INTEGER PRIMARY KEY NOT NULL,
        clinic_name TEXT NOT NULL,
        cases_delivered INTEGER,
        signature_blob TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Native SQLite initialized successfully.');
  } catch (error) {
    console.error('Database initialization failed:', error);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (Capacitor.isNativePlatform()) {
    initializeDatabase();
  } else {
    console.warn('App is running in a browser. Native SQLite is not available without a polyfill.');
  }
});
