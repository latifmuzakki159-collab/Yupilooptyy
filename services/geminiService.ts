
import { GoogleGenAI } from "@google/genai";
import { AppSettings, Message, Character, LorebookEntry } from "../types";
import { processPrompt } from "../utils/promptUtils";
import { scanLorebook } from "../utils/loreUtils";

// --- HELPERS ---

// Context Management (Token Estimation) logic shared by both providers
const prepareHistory = (history: Message[], newMessage: string, limit: number): Message[] => {
    const estimatedTokenLimit = limit; 
    let currentTokenCount = 0;
    const historyToSend: Message[] = [];

    // Always include the new message (approx calc)
    currentTokenCount += newMessage.length / 4;

    // Process history backwards
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        const estimatedTokens = msg.content.length / 4;

        if (currentTokenCount + estimatedTokens > estimatedTokenLimit) {
        break; 
        }

        historyToSend.unshift(msg); 
        currentTokenCount += estimatedTokens;
    }
    return historyToSend;
};

const buildSystemPrompt = (character: Character, settings: AppSettings, history: Message[], newMessage: string): string => {
    // Inject Critical Thinking Instruction first
    const thinkingInstruction = "PENTING: Sebelum menjawab, tuliskan proses berpikirmu, analisis logika, dan perencanaanmu di dalam tag <think>...</think>. Setelah itu, baru berikan jawaban kepada user.\n\n";
    
    let systemInstruction = thinkingInstruction + processPrompt(
        settings.systemPrompt, 
        character.name, 
        settings.userName
    );

    // Add specific character details
    systemInstruction += `\n\n[Character Name: ${character.name}]\n[Description: ${character.description}]\n[Personality: ${character.personality}]\n[Scenario: ${processPrompt(character.scenario || 'Free roam', character.name, settings.userName)}]`;

    // Lorebook Scanning
    const recentHistoryText = history.slice(-3).map(m => m.content).join(' ');
    const textToScan = recentHistoryText + ' ' + newMessage;
    
    const loreInjection = scanLorebook(
        textToScan, 
        character.lorebook, 
        character.name, 
        settings.userName
    );

    if (loreInjection) {
        systemInstruction += loreInjection;
    }

    return systemInstruction;
};

// --- Zhipu AI JWT Generator ---
// Zhipu requires a specific JWT format signed with the API Secret (HS256)
const generateZhipuToken = async (apiKey: string): Promise<string> => {
    try {
        const [id, secret] = apiKey.split('.');
        if (!id || !secret) return apiKey; // Return raw if format is unexpected

        const now = Date.now();
        const header = { alg: "HS256", sign_type: "SIGN" };
        const payload = {
            api_key: id,
            exp: now + 3600 * 1000, // 1 hour expiration
            timestamp: now
        };

        const base64UrlEncode = (str: string) => {
            return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        };

        const encodedHeader = base64UrlEncode(JSON.stringify(header));
        const encodedPayload = base64UrlEncode(JSON.stringify(payload));
        const dataToSign = `${encodedHeader}.${encodedPayload}`;

        const encoder = new TextEncoder();
        const keyData = encoder.encode(secret);
        
        const cryptoKey = await crypto.subtle.importKey(
            "raw", 
            keyData, 
            { name: "HMAC", hash: "SHA-256" }, 
            false, 
            ["sign"]
        );

        const signature = await crypto.subtle.sign(
            "HMAC", 
            cryptoKey, 
            encoder.encode(dataToSign)
        );

        // Convert signature buffer to binary string manually to avoid stack overflow on large buffers (though sig is small)
        const signatureArray = new Uint8Array(signature);
        let signatureBinary = '';
        for (let i = 0; i < signatureArray.length; i++) {
            signatureBinary += String.fromCharCode(signatureArray[i]);
        }
        
        const encodedSignature = base64UrlEncode(signatureBinary);

        return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
    } catch (e) {
        console.warn("JWT Generation failed, falling back to raw key", e);
        return apiKey;
    }
};


// --- GENERIC LLM REQUEST HANDLER ---
// This function handles the actual API call logic for both Chat and Utility tasks
export const makeLLMRequest = async (
    settings: AppSettings,
    messages: { role: string; content: string }[],
    systemInstruction?: string,
    jsonMode: boolean = false
): Promise<string> => {
    
    // Check for OpenAI Compatible Providers (SumoPod / ElectronHub / GLM / BytePlus / NVIDIA / Custom)
    if (['sumopod', 'electronhub', 'glm', 'byteplus', 'nvidia', 'custom'].includes(settings.serviceProvider)) {
        
        let endpoint = "";
        let apiKey = "";
        let providerName = "";

        if (settings.serviceProvider === 'sumopod') {
            endpoint = "https://ai.sumopod.com/v1/chat/completions";
            apiKey = settings.sumoPodApiKey;
            providerName = "SumoPod";
        } else if (settings.serviceProvider === 'electronhub') {
            endpoint = "https://api.electronhub.ai/v1/chat/completions";
            apiKey = settings.electronHubApiKey;
            providerName = "ElectronHub";
        } else if (settings.serviceProvider === 'glm') {
            endpoint = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
            // Zhipu AI usually needs JWT, let's generate it
            apiKey = await generateZhipuToken(settings.glmApiKey);
            providerName = "GLM";
        } else if (settings.serviceProvider === 'byteplus') {
            endpoint = "https://ark.byteplusapi.com/api/v3/chat/completions";
            apiKey = settings.byteplusApiKey;
            providerName = "BytePlus";
        } else if (settings.serviceProvider === 'nvidia') {
            endpoint = "https://integrate.api.nvidia.com/v1/chat/completions";
            apiKey = settings.nvidiaApiKey;
            providerName = "NVIDIA";
        } else if (settings.serviceProvider === 'custom') {
            endpoint = settings.customEndpoint;
            apiKey = settings.customApiKey;
            providerName = "Custom Provider";
        }
        
        // SumoPod / ElectronHub / GLM / BytePlus / NVIDIA / OpenAI Format
        const payloadMessages = [];
        if (systemInstruction) {
            payloadMessages.push({ role: "system", content: systemInstruction });
        }
        // Ensure content is not empty (Zhipu/BytePlus compatibility fix)
        const safeMessages = messages.map(m => ({
            ...m,
            content: m.content || " " 
        }));
        payloadMessages.push(...safeMessages);

        // Failsafe: If model is still set to Gemini default but provider is switched, use a safe default
        let modelId = settings.model;
        if (modelId.startsWith('gemini') || !modelId) {
             if (settings.serviceProvider === 'glm') modelId = 'glm-4-flash';
             else if (settings.serviceProvider === 'byteplus') modelId = 'doubao-pro-32k';
             else if (settings.serviceProvider === 'nvidia') modelId = 'meta/llama-3.1-405b-instruct'; // Good default for NVIDIA
             else modelId = 'gpt-4o-mini';
        }

        // Failsafe: Temperature range (Zhipu < 1.0 strict)
        let temp = settings.temperature;
        if (settings.serviceProvider === 'glm') {
            if (temp >= 1.0) temp = 0.95;
            if (temp <= 0.0) temp = 0.01;
        }

        const payload: any = {
            model: modelId,
            messages: payloadMessages,
            temperature: temp,
            stream: false
        };

        // Specific configurations for specific providers
        if (settings.serviceProvider === 'nvidia') {
            // NVIDIA NIMs often require explicit max_tokens.
            // Using 4096 as a safer default to prevent context length errors
            payload.max_tokens = 4096; 
            payload.top_p = 1.0; 

            // Logic for GLM-5 / Kimi / Thinking Models on NVIDIA
            // This enables the "Thinking" process if the model supports it (like z-ai/glm5)
            if (modelId === 'z-ai/glm5') {
                payload.chat_template_kwargs = { 
                    enable_thinking: true,
                    clear_thinking: false 
                };
            }
        }

        if (jsonMode) {
            payload.response_format = { type: "json_object" };
        }

        try {
            const headers: any = {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            };
            
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload),
                mode: 'cors'
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error?.message || `${providerName} Error: ${response.statusText} (${response.status})`);
            }

            const data = await response.json();
            const message = data.choices?.[0]?.message;
            let content = message?.content || "";

            // Handle "Reasoning Content" (DeepSeek/GLM-5 Style)
            // If the API returns reasoning in a separate field, we wrap it in <think> tags
            // so our frontend parser can display it correctly.
            if (message?.reasoning_content) {
                const thought = message.reasoning_content;
                content = `<think>${thought}</think>\n${content}`;
            }

            return content;
        } catch (error: any) {
            if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
                throw new Error(`${providerName} Network Error. Kemungkinan CORS atau parameter max_tokens terlalu tinggi. Coba gunakan Proxy atau kurangi context.`);
            }
            throw error;
        }

    } else {
        // Google Gemini Logic
        const ai = new GoogleGenAI({ apiKey: settings.apiKey || process.env.GEMINI_API_KEY });
        
        const geminiConfig: any = {
            temperature: settings.temperature,
            safetySettings: [
                {
                    category: "HARM_CATEGORY_HARASSMENT",
                    threshold: "BLOCK_NONE",
                },
                {
                    category: "HARM_CATEGORY_HATE_SPEECH",
                    threshold: "BLOCK_NONE",
                },
                {
                    category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                    threshold: "BLOCK_NONE",
                },
                {
                    category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                    threshold: "BLOCK_NONE",
                },
            ]
        };

        if (systemInstruction) {
            geminiConfig.systemInstruction = systemInstruction;
        }

        if (jsonMode) {
            geminiConfig.responseMimeType = "application/json";
        }

        const chat = ai.chats.create({
            model: settings.model,
            config: geminiConfig,
            history: messages.slice(0, -1).map(m => ({
                role: m.role === 'model' ? 'model' : 'user',
                parts: [{ text: m.content }]
            }))
        });

        const lastMsg = messages[messages.length - 1];
        const response = await chat.sendMessage({
            message: lastMsg.content
        });

        return response.text || "";
    }
};


// --- MAIN FUNCTIONS ---

export const generateReply = async (
  history: Message[],
  newMessage: string,
  character: Character,
  settings: AppSettings
): Promise<string> => {
  
  const historyToSend = prepareHistory(history, newMessage, settings.contextLimit);
  const systemInstruction = buildSystemPrompt(character, settings, history, newMessage);

  // Convert internal Message format to generic format
  const messages = historyToSend.map(m => ({
      role: m.role === 'model' ? 'assistant' : 'user', // 'assistant' maps to 'model' in makeLLMRequest for Gemini
      content: m.content
  }));
  messages.push({ role: 'user', content: newMessage });

  try {
    return await makeLLMRequest(settings, messages, systemInstruction);
  } catch (error: any) {
    console.error("AI Generation Error:", error);
    throw new Error(error.message || "Gagal menghubungi AI Service.");
  }
};

/**
 * Utility: Menerjemahkan keys Lorebook ke Bahasa Indonesia
 * Input: List of keys (e.g., ["Kingdom", "Sword"])
 * Output: Map of Original -> [Original, Translated] (e.g. { "Kingdom": ["Kingdom", "Kerajaan"] })
 */
export const translateLorebookKeys = async (
    entries: LorebookEntry[], 
    settings: AppSettings
): Promise<LorebookEntry[]> => {
    
    // Extract unique keys to save tokens
    const allKeys = Array.from(new Set(entries.flatMap(e => e.keys)));
    
    if (allKeys.length === 0) return entries;

    const prompt = `
    Saya memiliki daftar kata kunci (keywords) untuk Lorebook Roleplay.
    Sebagian besar dalam Bahasa Inggris. Saya ingin kamu menambahkan terjemahan Bahasa Indonesia untuk setiap kata kunci agar lorebook ini bekerja saat saya chatting dalam bahasa Indonesia.
    
    Daftar Kata Kunci:
    ${JSON.stringify(allKeys)}

    Instruksi:
    1. Untuk setiap kata kunci, berikan terjemahan bahasa Indonesianya yang relevan.
    2. Kembalikan dalam format JSON Object murni. Jangan gunakan Markdown formatting.
    3. Key adalah kata kunci asli, Value adalah ARRAY string yang berisi kata kunci asli DAN terjemahannya (dan variasi sinonim umum jika perlu).
    4. JANGAN hapus kata kunci asli.

    Contoh Output JSON:
    {
       "Kingdom": ["Kingdom", "Kerajaan", "Kekaisaran"],
       "Excalibur": ["Excalibur", "Pedang Excalibur"],
       "School": ["School", "Sekolah", "Akademi"]
    }
    `;

    try {
        const responseText = await makeLLMRequest(
            settings, 
            [{ role: 'user', content: prompt }], 
            "You are a helpful translator assistant. You output only valid JSON. No Markdown.",
            true // JSON Mode
        );

        // Sanitize response: Remove Markdown code blocks if model ignores instructions
        let cleanText = responseText.trim();
        if (cleanText.startsWith('```')) {
            cleanText = cleanText.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '');
        }

        const translationMap = JSON.parse(cleanText);
        
        // Map back to entries
        const updatedEntries = entries.map(entry => {
            let newKeys = new Set<string>();
            entry.keys.forEach(k => {
                newKeys.add(k); // Keep original
                if (translationMap[k] && Array.isArray(translationMap[k])) {
                    translationMap[k].forEach((translated: string) => newKeys.add(translated));
                }
            });
            return {
                ...entry,
                keys: Array.from(newKeys)
            };
        });

        return updatedEntries;

    } catch (e) {
        console.error("Translation Failed", e);
        throw new Error("Gagal menerjemahkan keys. Pastikan API Key valid dan model mendukung JSON.");
    }
};
