import { Message, Character, LorebookEntry } from "../types";

// Helper to generate IDs
const uuid = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

// --- CHAT HISTORY PARSERS ---

export const parseJSONL = (content: string): Message[] => {
  const lines = content.split('\n');
  const messages: Message[] = [];
  
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      let role: 'user' | 'model' = 'user';
      if (
        obj.role === 'assistant' || 
        obj.is_user === false || 
        obj.name !== 'You' && obj.name !== 'User'
      ) {
        role = 'model';
      }
      
      const textContent = obj.mes || obj.content || obj.text;

      if (textContent) {
          messages.push({
            id: uuid(),
            role,
            content: textContent,
            timestamp: obj.send_date || obj.timestamp || Date.now(),
            candidates: [textContent],
            currentIndex: 0
          });
      }
    } catch (e) {
      console.warn("Failed to parse JSONL line", e);
    }
  }
  return messages;
};

export const parseTextChat = (content: string, charName: string): Message[] => {
  const messages: Message[] = [];
  const lines = content.split('\n');
  
  let currentRole: 'user' | 'model' | null = null;
  let currentContentLines: string[] = [];
  
  // Map detected names to roles to ensure consistency throughout the file
  const roleMap: Record<string, 'user' | 'model'> = {};

  // Helper to normalize strings for comparison
  const normalize = (str: string) => str.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

  const getRole = (name: string): 'user' | 'model' => {
    // 1. Check if we already mapped this exact name string
    if (roleMap[name]) return roleMap[name];

    const normName = normalize(name);
    const normChar = normalize(charName);

    // 2. Check for common User aliases
    if (['you', 'user', 'me', 'player', 'anonymous'].includes(normName)) {
        roleMap[name] = 'user';
        return 'user';
    }

    // 3. Check for Character Name similarity
    // If the name is contained in charName or vice versa (e.g. "Mio" in "Mio Aizawa")
    // Length check > 2 avoids matching short common substrings accidentally
    if (normName.length > 2 && (normChar.includes(normName) || normName.includes(normChar))) {
        roleMap[name] = 'model';
        return 'model';
    }

    // 4. Fallback Heuristic (Smart Guess)
    // If we encounter a new unknown name:
    // - If we haven't found a Model yet, assume this FIRST unknown person is the Character.
    // - If we already have a Model, assume this new person is the User.
    const existingModel = Object.values(roleMap).includes('model');
    
    if (!existingModel) {
        roleMap[name] = 'model';
        return 'model';
    } else {
        roleMap[name] = 'user';
        return 'user';
    }
  };

  const flush = () => {
    if (currentRole && currentContentLines.length > 0) {
      const fullText = currentContentLines.join('\n').trim();
      if (fullText) {
        messages.push({
          id: uuid(),
          role: currentRole,
          content: fullText,
          timestamp: Date.now(),
          candidates: [fullText],
          currentIndex: 0
        });
      }
    }
    currentContentLines = [];
  };

  // Regex to capture "Name: Message" format. 
  // Captures up to 50 chars before a colon.
  const headerRegex = /^([^\n:]{1,50}):\s*(.*)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
       // Preserve paragraph breaks if we are inside a message
       if (currentRole) currentContentLines.push(''); 
       continue;
    }

    const match = trimmed.match(headerRegex);
    let isHeader = false;

    if (match) {
      const rawName = match[1].trim();
      const contentPart = match[2];
      
      const role = getRole(rawName);
      
      if (role) {
          isHeader = true;
          flush(); // Flush previous message
          currentRole = role;
          if (contentPart.trim()) {
             currentContentLines.push(contentPart);
          }
      }
    }

    if (!isHeader) {
        // Not a header, append to current message
        if (currentRole) {
            currentContentLines.push(trimmed);
        }
    }
  }
  
  flush(); // Final flush
  return messages;
};

export const exportToJSONL = (messages: Message[], charName: string): string => {
  return messages.map(m => JSON.stringify({
    name: m.role === 'user' ? 'You' : charName,
    is_user: m.role === 'user',
    is_name: true,
    send_date: m.timestamp,
    mes: m.content
  })).join('\n');
};

export const exportToText = (messages: Message[], charName: string): string => {
  return messages.map(m => {
    const name = m.role === 'user' ? 'You' : charName;
    return `${name}:\n${m.content}`;
  }).join('\n\n');
};


// --- CHARACTER CARD PARSER (PNG & JSON) ---

// Helper to read Text Chunks from PNG (Metadata)
export const extractMetadataFromPNG = async (file: File): Promise<any | null> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      const view = new DataView(buffer);
      
      // PNG Signature Check
      if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) {
        resolve(null);
        return;
      }

      let offset = 8;
      const decoder = new TextDecoder("utf-8"); // Tavern standard uses iso-8859-1 usually but let's try utf-8 first or raw

      while (offset < view.byteLength) {
        const length = view.getUint32(offset);
        const type = decoder.decode(buffer.slice(offset + 4, offset + 8));
        
        if (type === 'tEXt') {
          const data = new Uint8Array(buffer, offset + 8, length);
          // tEXt format: Keyword + Null Separator + Text
          let nullIndex = -1;
          for(let i=0; i<data.length; i++) {
            if(data[i] === 0) { nullIndex = i; break; }
          }

          if (nullIndex !== -1) {
            const keyword = decoder.decode(data.slice(0, nullIndex));
            const text = decoder.decode(data.slice(nullIndex + 1));

            if (keyword.toLowerCase() === 'chara') {
               // Found the character data! It's usually Base64 encoded string of the JSON
               try {
                 const decodedJson = atob(text);
                 resolve(JSON.parse(decodedJson));
                 return;
               } catch (e) {
                 console.error("Failed to decode base64 from PNG", e);
               }
            }
          }
        }
        
        offset += 12 + length; // Length(4) + Type(4) + Data(Length) + CRC(4)
      }
      resolve(null);
    };
    reader.readAsArrayBuffer(file);
  });
};

export const parseTavernCharacter = (json: any): Character | null => {
  try {
    const now = Date.now().toString();
    
    // Check for V2 Spec (wrapped in 'data') or flattened
    const data = json.data || json;

    // Mandatory fields check (loose)
    if (!data.name) return null;

    // Try to find image in JSON fields
    let avatarUrl = `https://ui-avatars.com/api/?name=${data.name}&background=random`;
    
    // Check for base64 embedded image or URL in common fields
    if (data.avatar && (data.avatar.startsWith('data:image') || data.avatar.startsWith('http'))) {
        avatarUrl = data.avatar;
    } else if (data.image && (data.image.startsWith('data:image') || data.image.startsWith('http'))) {
        avatarUrl = data.image;
    }

    const char: Character = {
      id: now,
      name: data.name,
      description: data.description || '',
      personality: data.personality || '',
      firstMessage: data.first_mes || data.firstMessage || 'Hello!',
      scenario: data.scenario || '',
      avatarUrl: avatarUrl
    };

    // Handle "mes_example"
    if (data.mes_example) {
      char.personality += `\n\n[Example Dialogue]:\n${data.mes_example}`;
    }
    
    return char;
  } catch (e) {
    console.error("Error parsing character card", e);
    return null;
  }
};

// --- LOREBOOK PARSER (Chub/SillyTavern/V2) ---

export const parseLorebook = (json: any): LorebookEntry[] => {
    const entries: LorebookEntry[] = [];
    
    try {
        let rawEntries = json.entries || json;
        
        // Handle nested structure from Chub AI / V2 Spec (object with numeric keys)
        if (rawEntries && typeof rawEntries === 'object' && !Array.isArray(rawEntries)) {
            // Convert dictionary to array
            rawEntries = Object.values(rawEntries);
        }

        if (Array.isArray(rawEntries)) {
            rawEntries.forEach((item: any) => {
                // Determine keys: Combine 'key' and 'keysecondary'
                let keys: string[] = [];
                
                if (Array.isArray(item.key)) {
                    keys = [...keys, ...item.key];
                } else if (typeof item.key === 'string') {
                    keys.push(item.key);
                }

                if (Array.isArray(item.keysecondary)) {
                    keys = [...keys, ...item.keysecondary];
                }

                // Clean keys
                keys = keys.map(k => k.trim()).filter(k => k.length > 0);

                // Determine content
                const content = item.content || item.entry || '';

                if (content || keys.length > 0) {
                    entries.push({
                        id: uuid(), // Generate new ID to avoid collisions
                        keys: keys,
                        entry: content,
                        enabled: item.enabled !== false // Default true unless explicitly false
                    });
                }
            });
        }
    } catch (e) {
        console.error("Failed to parse lorebook", e);
    }

    return entries;
};