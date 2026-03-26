import { LorebookEntry } from "../types";
import { processPrompt } from "./promptUtils";

/**
 * Memindai teks (pesan user + history singkat) terhadap Lorebook.
 * Mengembalikan string gabungan dari entry yang cocok.
 */
export const scanLorebook = (
    textToScan: string, 
    lorebook: LorebookEntry[] | undefined,
    charName: string,
    userName: string
): string => {
    if (!lorebook || lorebook.length === 0) return "";

    const activeLore: Set<string> = new Set();
    const normalizedText = textToScan.toLowerCase();

    lorebook.forEach(info => {
        // Skip if disabled
        if (info.enabled === false) return;

        // Check keys
        const isMatch = info.keys.some(key => {
            const trimmedKey = key.trim().toLowerCase();
            return trimmedKey && normalizedText.includes(trimmedKey);
        });

        if (isMatch) {
            // Process placeholders inside the lore entry itself
            activeLore.add(processPrompt(info.entry, charName, userName));
        }
    });

    if (activeLore.size > 0) {
        return `\n\n[World Info / Lorebook / Context Notes]:\n${Array.from(activeLore).join('\n')}`;
    }

    return "";
};