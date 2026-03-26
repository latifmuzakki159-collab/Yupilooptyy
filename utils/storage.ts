import { AppSettings, Character, DEFAULT_SETTINGS, Message } from "../types";

const KEYS = {
  SETTINGS: 'grh_settings',
  // Legacy LocalStorage keys for migration
  LS_CHARACTERS: 'grh_characters',
  LS_CHATS_PREFIX: 'grh_chats_',
};

// IndexedDB Constants
const DB_NAME = 'GeminiRP_DB';
const DB_VERSION = 1;
const STORE_NAME = 'app_data';

// --- IndexedDB Helpers ---

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const dbOp = async (mode: IDBTransactionMode, callback: (store: IDBObjectStore) => void): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        callback(store);
    });
};

const dbGet = async <T>(key: string): Promise<T | null> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
    });
};

const dbSet = async (key: string, value: any): Promise<void> => {
    return dbOp('readwrite', store => store.put(value, key));
};

const dbDel = async (key: string): Promise<void> => {
    return dbOp('readwrite', store => store.delete(key));
};

// --- Settings (Keep in LocalStorage for sync access) ---
export const loadSettings = (): AppSettings => {
  const stored = localStorage.getItem(KEYS.SETTINGS);
  return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
};

export const saveSettings = (settings: AppSettings) => {
  localStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
};

// --- Characters (Async IndexedDB) ---

export const loadCharacters = async (): Promise<Character[]> => {
    // 1. Try DB
    const chars = await dbGet<Character[]>('characters');
    if (chars) return chars;

    // 2. Migration: Check LocalStorage if DB is empty
    const lsChars = localStorage.getItem(KEYS.LS_CHARACTERS);
    if (lsChars) {
        try {
            const parsed = JSON.parse(lsChars);
            await dbSet('characters', parsed);
            // We keep LS for now as backup, or could delete it
            return parsed;
        } catch (e) {
            console.error("Migration failed", e);
        }
    }
    return [];
};

export const saveCharacters = async (characters: Character[]) => {
    await dbSet('characters', characters);
};

// --- Chats (Async IndexedDB) ---

export const loadChat = async (charId: string): Promise<Message[]> => {
    const key = `chat_${charId}`;
    const msgs = await dbGet<Message[]>(key);
    if (msgs) return msgs;

    // Migration
    const lsKey = KEYS.LS_CHATS_PREFIX + charId;
    const lsChat = localStorage.getItem(lsKey);
    if (lsChat) {
        try {
            const parsed = JSON.parse(lsChat);
            await dbSet(key, parsed);
            return parsed;
        } catch(e) {}
    }
    return [];
};

export const saveChat = async (charId: string, messages: Message[]) => {
    await dbSet(`chat_${charId}`, messages);
};

export const deleteChat = async (charId: string) => {
    await dbDel(`chat_${charId}`);
    localStorage.removeItem(KEYS.LS_CHATS_PREFIX + charId); // Clean legacy
};

// --- Full Backup/Restore ---

export interface BackupData {
    settings: AppSettings;
    characters: Character[];
    chats: Record<string, Message[]>;
}

export const exportAllData = async (): Promise<string> => {
    const settings = loadSettings();
    const characters = await loadCharacters();
    const chats: Record<string, Message[]> = {};
    
    for (const char of characters) {
        chats[char.id] = await loadChat(char.id);
    }
    
    const backup: BackupData = { settings, characters, chats };
    return JSON.stringify(backup, null, 2);
};

export const importAllData = async (json: string): Promise<void> => {
    try {
        const data: BackupData = JSON.parse(json);
        
        // Restore Settings
        if (data.settings) saveSettings(data.settings);
        
        // Restore Characters
        if (data.characters && Array.isArray(data.characters)) {
            await saveCharacters(data.characters);
        }
        
        // Restore Chats
        if (data.chats) {
            for (const [charId, msgs] of Object.entries(data.chats)) {
                await saveChat(charId, msgs);
            }
        }
    } catch (e) {
        throw new Error("Gagal membaca file backup. Format tidak valid.");
    }
};