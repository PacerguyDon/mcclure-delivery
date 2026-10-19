import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';

// Declare variables globally, but do NOT instantiate them yet
let sqlite;
let db;

async function initializeDatabase() {
    try {
        // Instantiate the connection INSIDE this protected function
        sqlite = new SQLiteConnection(CapacitorSQLite);
        
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
        
        // Expose plugins to the window object ONLY if running natively
        window.NativeFilesystem = Filesystem;
        window.NativeShare = Share;
        window.NativeDirectory = Directory;
        window.NativeDB = db; // Expose the db connection so your HTML file can use it
        
    } catch (error) {
        console.error('Database initialization failed:', error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // This strictly fences off the native code
    if (Capacitor.isNativePlatform()) {
        initializeDatabase();
    } else {
        console.warn('App is running in a browser. Using localForage fallback instead of Native SQLite.');
        // Ensure web-only variables are set to null so logic in index.html doesn't break
        window.NativeFilesystem = null;
        window.NativeShare = null;
        window.NativeDirectory = null;
        window.NativeDB = null;
    }
});
