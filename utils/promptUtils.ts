/**
 * Memproses teks prompt dengan mengganti placeholder variabel.
 * 
 * Placeholder yang didukung:
 * - {{user}} : Nama pengguna
 * - {{char}} : Nama karakter
 * - {{time}} : Waktu saat ini (HH:mm)
 */
export const processPrompt = (text: string, charName: string, userName: string): string => {
    if (!text) return "";
    
    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return text
        .replace(/{{user}}/gi, userName)
        .replace(/{{char}}/gi, charName)
        .replace(/{{time}}/gi, timeString);
};