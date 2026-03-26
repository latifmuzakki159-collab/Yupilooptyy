import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AppSettings, Character, Message, LorebookEntry } from '../types';
import { loadCharacters, loadChat, saveChat, saveCharacters } from '../utils/storage';
import { generateReply } from '../services/geminiService';
import { parseJSONL, parseTextChat, exportToJSONL, exportToText } from '../utils/parsers';
import LorebookModal from '../components/LorebookModal';
import CollaborativeBridge from '../components/CollaborativeBridge';
import ConfirmModal from '../components/ConfirmModal';

interface Props {
  settings: AppSettings;
}

const uuid = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

// --- HELPER: Parse Thought ---
const parseThoughtAndContent = (rawText: string): { content: string, thought: string } => {
    // Regex to capture content inside <think>...</think> (case insensitive, multiline)
    const thinkRegex = /<think>([\s\S]*?)<\/think>/i;
    const match = rawText.match(thinkRegex);

    if (match) {
        const thought = match[1].trim();
        const content = rawText.replace(thinkRegex, '').trim();
        return { content, thought };
    }

    return { content: rawText, thought: '' };
};

const ChatPage: React.FC<Props> = ({ settings }) => {
  const { charId } = useParams<{ charId: string }>();
  const [character, setCharacter] = useState<Character | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [view, setView] = useState<'landing' | 'chat'>('landing');
  const [hasHistory, setHasHistory] = useState(false);
  
  // UI States
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showAdvancedControls, setShowAdvancedControls] = useState(true); // Default ON, toggleable
  const [showMenu, setShowMenu] = useState(false);
  const [isLorebookOpen, setIsLorebookOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');

  // Confirmation Modals State
  const [confirmAction, setConfirmAction] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  const closeConfirm = () => setConfirmAction(prev => ({ ...prev, isOpen: false }));

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load Character & History (ASYNC)
  useEffect(() => {
    const init = async () => {
        const chars = await loadCharacters();
        const found = chars.find(c => c.id === charId);
        if (found) {
          setCharacter(found);
          const history = await loadChat(found.id);
          if (history.length > 0) {
            // Ensure legacy messages have candidates structure AND IDs
            const migrated = history.map(m => ({
                ...m,
                id: m.id || uuid(), // Ensure ID exists
                candidates: m.candidates || [m.content],
                thoughts: m.thoughts || (m.thought ? [m.thought] : []), // Migrate thoughts
                currentIndex: m.currentIndex || 0
            }));
            setMessages(migrated);
            setHasHistory(true);
          } else {
            // Fresh start
            const initialMsg: Message = {
                id: uuid(),
                role: 'model',
                content: found.firstMessage,
                timestamp: Date.now(),
                candidates: [found.firstMessage],
                thoughts: [],
                currentIndex: 0
            };
            setMessages([initialMsg]);
            setHasHistory(false);
          }
        }
    };
    init();
  }, [charId]);

  // Auto-save (ASYNC)
  useEffect(() => {
    if (view === 'chat' && character) {
        // Fire and forget save
        saveChat(character.id, messages).catch(console.error);
    }
  }, [messages, view, character]);

  // Sync State to Bridge (SillyTavern-like Context Sync)
  useEffect(() => {
    if (view === 'chat' && character && settings.bridgeEnabled && settings.bridgeUrl) {
        const syncState = async () => {
            try {
                const cleanUrl = settings.bridgeUrl.replace(/\/$/, '');
                await fetch(`${cleanUrl}/sync-state`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        session_id: settings.bridgeSessionId,
                        character: {
                            name: character.name,
                            description: character.description,
                            personality: character.personality,
                            scenario: character.scenario,
                            firstMessage: character.firstMessage,
                            lorebook: character.lorebook
                        },
                        messages: messages.map(m => ({
                            role: m.role,
                            content: m.candidates?.[m.currentIndex || 0] || m.content
                        }))
                    })
                });
            } catch (e) {
                // Ignore sync errors to prevent console spam
            }
        };
        
        // Debounce sync to avoid spamming the server on rapid changes
        const timeoutId = setTimeout(syncState, 1500);
        return () => clearTimeout(timeoutId);
    }
  }, [messages, view, character, settings.bridgeEnabled, settings.bridgeUrl, settings.bridgeSessionId]);

  // Scroll to bottom on new message (only if not editing/swiping history)
  useEffect(() => {
      if (view === 'chat' && !isLoading) {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
  }, [messages.length, view]);

  const handleStartChat = () => {
    setView('chat');
  };

  const handleResetChat = async (silent: boolean = false) => {
    const doReset = async () => {
        if (character) {
            const initial: Message = { 
                id: uuid(),
                role: 'model', 
                content: character.firstMessage, 
                timestamp: Date.now(),
                candidates: [character.firstMessage],
                thoughts: [],
                currentIndex: 0
            };
            setMessages([initial]);
            await saveChat(character.id, [initial]);
            setHasHistory(false);
            if(!silent) setView('landing');
        }
        closeConfirm();
    };

    if (!silent) {
        setConfirmAction({
            isOpen: true,
            title: 'Hapus Riwayat Chat',
            message: 'Apakah Anda yakin ingin menghapus semua riwayat obrolan dengan karakter ini? Tindakan ini tidak dapat dibatalkan.',
            onConfirm: doReset
        });
    } else {
        doReset();
    }
  };

  const processResponse = async (history: Message[], userInput: string, hiddenDirection?: string) => {
      setIsLoading(true);
      try {
        let promptToSend = userInput;
        if (hiddenDirection) {
            const directionPrompt = `[ARAHAN SISTEM (JANGAN DIBALAS SECARA EKSPLISIT, IKUTI SAJA ALURNYA): ${hiddenDirection}]`;
            promptToSend = promptToSend ? `${promptToSend}\n\n${directionPrompt}` : directionPrompt;
        }

        // character state here already includes the updated lorebook if modified via modal
        const replyRaw = await generateReply(history, promptToSend, character!, settings);
        
        // Parse Thought
        const { content, thought } = parseThoughtAndContent(replyRaw);

        // Add new Model message
        const botMsg: Message = { 
            id: uuid(),
            role: 'model', 
            content: content, 
            thought: thought, // Active thought
            timestamp: Date.now(),
            candidates: [content],
            thoughts: [thought], // Store parallel to candidates
            currentIndex: 0,
            isThoughtExpanded: false
        };
        setMessages(prev => [...prev, botMsg]);
      } catch (error: any) {
        // Improved Error Handling: Inject error as a system message
        const errorMessage = `[SYSTEM ERROR]: ${error.message || 'Terjadi kesalahan tidak dikenal saat menghubungi AI.'}`;
        const errorMsg: Message = { 
            id: uuid(),
            role: 'model', 
            content: errorMessage, 
            timestamp: Date.now(),
            candidates: [errorMessage],
            currentIndex: 0
        };
        setMessages(prev => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
      }
  };

  const handleSendMessage = async (overrideContent?: string, hiddenDirection?: string) => {
    const textToSend = typeof overrideContent === 'string' ? overrideContent : input;
    if ((!textToSend.trim() && !hiddenDirection?.trim()) || !character || isLoading) return;

    let newHistory = [...messages];
    
    if (textToSend.trim()) {
        const userMsg: Message = { 
            id: uuid(),
            role: 'user', 
            content: textToSend, 
            timestamp: Date.now(),
            candidates: [textToSend],
            currentIndex: 0
        };
        
        newHistory = [...messages, userMsg];
        setMessages(newHistory);
        if (textToSend === input) setInput('');
    }
    
    await processResponse(newHistory, textToSend, hiddenDirection);
  };

  // --- LOREBOOK HANDLING ---

  const handleSaveLorebook = async (newLorebook: LorebookEntry[]) => {
      if (!character) return;
      
      const updatedChar = { ...character, lorebook: newLorebook };
      setCharacter(updatedChar);

      // Persist to DB immediately
      try {
          const allChars = await loadCharacters();
          const updatedAllChars = allChars.map(c => c.id === character.id ? updatedChar : c);
          await saveCharacters(updatedAllChars);
      } catch (e) {
          console.error("Failed to save lorebook changes", e);
      }
  };

  const handleImportChat = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !character) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
        const content = ev.target?.result as string;
        let newMessages: Message[] = [];

        try {
            if (file.name.endsWith('.jsonl') || file.name.endsWith('.json')) {
                newMessages = parseJSONL(content);
            } else {
                newMessages = parseTextChat(content, character.name);
            }

            if (newMessages.length > 0) {
                 // Migrate structure & Ensure IDs
                 const migrated = newMessages.map(m => ({
                    ...m,
                    id: m.id || uuid(),
                    candidates: m.candidates || [m.content],
                    currentIndex: m.currentIndex || 0
                }));
                setMessages(migrated);
                await saveChat(character.id, migrated); 
                setHasHistory(true);
                alert(`Berhasil mengimpor ${newMessages.length} pesan!`);
            } else {
                alert('Gagal membaca pesan atau format tidak dikenali.');
            }
        } catch (err) {
            console.error(err);
            alert('Terjadi kesalahan saat memproses file.');
        }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleExportChat = (format: 'jsonl' | 'text') => {
      if(!character) return;
      let content = '';
      const filename = `${character.name}_chat.${format === 'text' ? 'txt' : format}`;

      // Use active content for export
      const activeMessages = messages.map(m => ({
          ...m,
          content: m.candidates?.[m.currentIndex || 0] || m.content
      }));

      if (format === 'jsonl') {
          content = exportToJSONL(activeMessages, character.name);
      } else {
          content = exportToText(activeMessages, character.name);
      }

      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
  };

  // --- BRANCHING, EDITING & THOUGHT FUNCTIONS ---

  const handleDeleteMessage = (targetId: string) => {
      setConfirmAction({
          isOpen: true,
          title: 'Hapus Pesan',
          message: 'Apakah Anda yakin ingin menghapus pesan ini?',
          onConfirm: () => {
              const newMsgs = messages.filter(m => m.id !== targetId);
              setMessages(newMsgs);
              closeConfirm();
          }
      });
  };

  const toggleThought = (msgId: string) => {
      setMessages(messages.map(m => {
          if (m.id === msgId) {
              return { ...m, isThoughtExpanded: !m.isThoughtExpanded };
          }
          return m;
      }));
  };

  const handleSwipe = (index: number, direction: 'left' | 'right') => {
      const msgs = [...messages];
      const msg = msgs[index];
      if (!msg.candidates) return;
      
      const current = msg.currentIndex || 0;
      let next = direction === 'left' ? current - 1 : current + 1;
      
      // Loop around
      if (next < 0) next = msg.candidates.length - 1;
      if (next >= msg.candidates.length) next = 0;

      msg.currentIndex = next;
      msg.content = msg.candidates[next]; // Sync content for compatibility
      
      // Sync Thought if array exists
      if (msg.thoughts && msg.thoughts.length > next) {
          msg.thought = msg.thoughts[next];
      } else {
          msg.thought = '';
      }

      setMessages(msgs);
  };

  const handleStartEdit = (index: number) => {
      const msg = messages[index];
      const activeContent = msg.candidates?.[msg.currentIndex || 0] || msg.content;
      setEditContent(activeContent);
      setEditingIndex(index);
  };

  const handleSaveEdit = (index: number) => {
      const msgs = [...messages];
      const msg = msgs[index];
      
      // Ensure candidates exist
      if (!msg.candidates) msg.candidates = [msg.content];
      if (typeof msg.currentIndex === 'undefined') msg.currentIndex = 0;

      // Update current candidate
      msg.candidates[msg.currentIndex] = editContent;
      msg.content = editContent;

      setMessages(msgs);
      setEditingIndex(null);
      setEditContent('');
  };

  const handleRegenerate = async (index: number) => {
      if (isLoading || !character) return;
      
      const historyContext = messages.slice(0, index);
      if (messages[index].role !== 'model') return;

      setIsLoading(true);
      try {
          let lastUserMsg = "";
          const contextForGen: Message[] = [];
          
          if (index > 0) {
             const prevMsg = messages[index - 1];
             if (prevMsg.role === 'user') {
                 lastUserMsg = prevMsg.candidates?.[prevMsg.currentIndex || 0] || prevMsg.content;
                 contextForGen.push(...messages.slice(0, index - 1));
                 contextForGen.push({...prevMsg, content: lastUserMsg});
             } else {
                 contextForGen.push(...messages.slice(0, index));
             }
          }

          const replyRaw = await generateReply(contextForGen, lastUserMsg, character, settings);
          const { content, thought } = parseThoughtAndContent(replyRaw);
          
          const msgs = [...messages];
          const msg = msgs[index];
          if(!msg.candidates) msg.candidates = [msg.content];
          if(!msg.thoughts) msg.thoughts = [msg.thought || ''];
          
          msg.candidates.push(content);
          msg.thoughts.push(thought);
          
          msg.currentIndex = msg.candidates.length - 1;
          msg.content = content;
          msg.thought = thought;
          
          setMessages(msgs);
      } catch (e: any) {
           // Improved Error Handling for Regenerate
           const errorMsg = `[SYSTEM ERROR]: ${e.message || 'Gagal regenerasi respon.'}`;
           const msgs = [...messages];
           const msg = msgs[index];
           if(!msg.candidates) msg.candidates = [msg.content];
           
           msg.candidates.push(errorMsg);
           msg.currentIndex = msg.candidates.length - 1;
           msg.content = errorMsg;
           setMessages(msgs);
      } finally {
          setIsLoading(false);
      }
  };

  if (!character) return <div className="p-10 text-white">Memuat karakter...</div>;

  // --- LANDING PAGE ---
  if (view === 'landing') {
    return (
      <div className="h-full w-full relative bg-gray-900 overflow-y-auto custom-scrollbar">
        <div 
            className="fixed inset-0 z-0 opacity-30 bg-cover bg-center filter blur-xl scale-110 pointer-events-none"
            style={{ backgroundImage: `url(${character.avatarUrl})` }}
        />
        <div className="fixed inset-0 z-0 bg-black/60 pointer-events-none" />
        <div className="relative z-10 min-h-full flex items-center justify-center p-4 py-10">
            <div className="w-full max-w-5xl bg-gray-850/90 border border-gray-700 rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row">
                <div className="w-full md:w-5/12 relative group bg-black h-64 md:h-auto shrink-0">
                    <img src={character.avatarUrl} alt={character.name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition duration-700" />
                    <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-transparent to-transparent"></div>
                    <div className="absolute bottom-0 left-0 w-full p-6 bg-gradient-to-t from-black/90 to-transparent">
                        <h1 className="text-3xl md:text-4xl font-bold text-white drop-shadow-lg mb-2 leading-tight">{character.name}</h1>
                        {hasHistory ? (
                            <div className="inline-flex items-center px-3 py-1 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 text-xs font-bold"><i className="fas fa-history mr-2"></i> {messages.length} Pesan</div>
                        ) : (
                            <div className="inline-flex items-center px-3 py-1 rounded-full bg-primary-500/20 text-primary-400 border border-primary-500/30 text-xs font-bold"><i className="fas fa-star mr-2"></i> Chat Baru</div>
                        )}
                    </div>
                </div>
                <div className="w-full md:w-7/12 p-6 md:p-8 flex flex-col bg-gray-900/50 backdrop-blur-sm">
                    <div className="mb-6 md:flex-1 md:overflow-y-auto md:pr-2 custom-scrollbar max-h-[400px] md:max-h-[60vh]">
                        <div className="mb-6">
                            <h3 className="text-gray-500 text-xs uppercase tracking-widest font-bold mb-3 flex items-center gap-2"><i className="fas fa-align-left"></i> Tentang Karakter</h3>
                            <p className="text-gray-300 leading-7 text-sm whitespace-pre-wrap font-light border-l-2 border-gray-700 pl-4">{character.description}</p>
                        </div>
                        <div>
                            <h3 className="text-gray-500 text-xs uppercase tracking-widest font-bold mb-3 flex items-center gap-2"><i className="fas fa-quote-left"></i> Pesan Pembuka</h3>
                            <div className="bg-gray-800/50 p-5 rounded-xl text-gray-300 text-sm italic border border-gray-700/50">"{character.firstMessage.slice(0, 300)}{character.firstMessage.length > 300 ? '...' : ''}"</div>
                        </div>
                    </div>
                    <div className="space-y-4 border-t border-gray-800 pt-6 mt-auto">
                        <button onClick={handleStartChat} className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition transform active:scale-95 ${hasHistory ? 'bg-green-600 hover:bg-green-500 text-white shadow-green-500/20' : 'bg-primary-600 hover:bg-primary-500 text-white shadow-primary-500/20'}`}>
                            {hasHistory ? <><i className="fas fa-play"></i> Lanjutkan Chat</> : <><i className="fas fa-comments"></i> Mulai Obrolan</>}
                        </button>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="relative group col-span-1">
                                <button onClick={() => fileInputRef.current?.click()} className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 py-3 rounded-xl text-sm font-medium transition flex flex-col items-center justify-center gap-1 h-full min-h-[80px]"><i className="fas fa-file-import text-lg"></i><span>Impor</span></button>
                                <input type="file" ref={fileInputRef} onChange={handleImportChat} accept=".txt,.json,.jsonl" className="hidden" />
                            </div>
                             <div className="relative group col-span-1">
                                <button className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 py-3 rounded-xl text-sm font-medium transition flex flex-col items-center justify-center gap-1 h-full min-h-[80px]"><i className="fas fa-download text-lg"></i><span>Unduh</span></button>
                                <div className="absolute bottom-full left-0 w-full mb-2 bg-gray-800 rounded-xl shadow-xl border border-gray-600 overflow-hidden opacity-0 group-hover:opacity-100 invisible group-hover:visible transition-all z-20">
                                    <button onClick={() => handleExportChat('text')} className="block w-full text-left px-4 py-3 hover:bg-gray-700 text-xs text-white border-b border-gray-700">Teks (.txt)</button>
                                    <button onClick={() => handleExportChat('jsonl')} className="block w-full text-left px-4 py-3 hover:bg-gray-700 text-xs text-white">JSONL</button>
                                </div>
                            </div>
                            <button onClick={() => handleResetChat(false)} className="col-span-1 bg-gray-800 hover:bg-red-900/30 hover:border-red-500/50 hover:text-red-400 border border-gray-700 text-gray-300 py-3 rounded-xl text-sm font-medium transition flex flex-col items-center justify-center gap-1 h-full min-h-[80px]"><i className="fas fa-trash-alt text-lg"></i><span>Reset</span></button>
                        </div>
                        <div className="text-center mt-2"><Link to="/" className="text-gray-500 hover:text-white text-sm transition flex items-center justify-center gap-2"><i className="fas fa-arrow-left"></i> Kembali ke Daftar</Link></div>
                    </div>
                </div>
            </div>
        </div>
      </div>
    );
  }

  // --- ACTIVE CHAT VIEW ---
  return (
    <div className="flex flex-col h-screen bg-[#0f0f12]">
      {/* Chat Header */}
      <header className="h-16 border-b border-gray-800 bg-gray-950/80 backdrop-blur flex items-center justify-between px-6 shrink-0 z-20">
        <div className="flex items-center gap-4">
            <button onClick={() => setView('landing')} className="text-gray-400 hover:text-white transition">
                <i className="fas fa-chevron-left"></i>
            </button>
            <div className="w-10 h-10 rounded-full overflow-hidden border border-gray-700">
                <img src={character.avatarUrl} alt="" className="w-full h-full object-cover" />
            </div>
            <div>
                <h2 className="font-bold text-white text-lg leading-tight">{character.name}</h2>
                <span className="text-xs text-green-500 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> Online
                </span>
            </div>
        </div>

        <div className="flex items-center gap-2 relative">
            {/* Lorebook Toggle Button */}
            <button 
                onClick={() => setIsLorebookOpen(true)}
                className="text-gray-400 hover:text-primary-400 p-2 transition rounded-lg"
                title="Buka Lorebook (World Info)"
            >
                <i className="fas fa-book"></i>
            </button>

            <button 
                onClick={() => setShowMenu(!showMenu)} 
                className={`text-gray-400 hover:text-white p-2 transition rounded-lg ${showMenu ? 'bg-gray-800 text-white' : ''}`}
            >
                <i className="fas fa-ellipsis-v"></i>
            </button>
            
            {showMenu && (
                <div className="absolute top-full right-0 mt-2 w-48 bg-gray-850 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden animate-fade-in">
                    <div className="p-2">
                         <button 
                            onClick={() => { setShowAdvancedControls(!showAdvancedControls); setShowMenu(false); }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 rounded-lg flex items-center justify-between"
                        >
                            <span>Mode Lanjutan</span>
                            {showAdvancedControls ? <i className="fas fa-toggle-on text-primary-500"></i> : <i className="fas fa-toggle-off text-gray-500"></i>}
                        </button>
                        <div className="h-px bg-gray-700 my-1"></div>
                        <button onClick={() => { handleExportChat('jsonl'); setShowMenu(false); }} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 rounded-lg"><i className="fas fa-save mr-2 w-4"></i> Simpan Chat</button>
                        <button onClick={() => { handleResetChat(); setShowMenu(false); }} className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-900/30 rounded-lg"><i className="fas fa-trash mr-2 w-4"></i> Hapus Chat</button>
                    </div>
                </div>
            )}
        </div>
      </header>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 scroll-smooth custom-scrollbar">
        {messages.map((msg, idx) => {
            const isUser = msg.role === 'user';
            const candidates = msg.candidates || [msg.content];
            const currentIdx = msg.currentIndex || 0;
            const activeContent = candidates[currentIdx];
            const isEditing = editingIndex === idx;
            const isError = activeContent.startsWith('[SYSTEM ERROR]:');

            // Render Formatting Logic (Improved)
            const renderContent = (text: string) => {
                // Split paragraphs first
                return text.split('\n').map((line, i) => (
                    <p key={i} className="mb-2 min-h-[1rem] whitespace-pre-wrap">
                        {/* Split by Bold (**) and Italic (*) delimiters, keeping delimiters in result */}
                        {line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, j) => {
                            if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
                                // Bold: **Text**
                                return <span key={j} className="text-white font-bold">{part.slice(2, -2)}</span>;
                            } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
                                // Italic: *Text*
                                return <span key={j} className="text-gray-400 italic">{part.slice(1, -1)}</span>;
                            } else {
                                // Normal Dialog: Text
                                return <span key={j} className="text-gray-200">{part}</span>;
                            }
                        })}
                    </p>
                ));
            };

            return (
                <div key={msg.id} className={`flex w-full group ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <div className={`flex flex-col max-w-[90%] md:max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
                        
                        <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                            {/* Avatar */}
                            <div className="shrink-0 w-8 h-8 rounded-full overflow-hidden mt-1 shadow-lg">
                                {isUser ? (
                                    <div className="w-full h-full bg-gray-700 flex items-center justify-center text-xs text-gray-300">
                                        <i className="fas fa-user"></i>
                                    </div>
                                ) : (
                                    <img src={character.avatarUrl} className="w-full h-full object-cover" />
                                )}
                            </div>

                            <div className="flex flex-col">
                                {/* THOUGHT PROCESS BUBBLE */}
                                {!isUser && msg.thought && (
                                    <div className="mb-2 max-w-full bg-gray-900/80 border border-gray-700/50 rounded-xl overflow-hidden shadow-sm animate-fade-in self-start w-full">
                                        <div 
                                            onClick={() => toggleThought(msg.id)}
                                            className="px-3 py-2 bg-gray-800/50 flex items-center justify-between cursor-pointer hover:bg-gray-800 transition"
                                        >
                                            <div className="flex items-center gap-2 text-xs font-bold text-gray-400">
                                                <i className="fas fa-brain text-primary-500"></i>
                                                Thought Process
                                            </div>
                                            <button className="text-gray-500 hover:text-white transition">
                                                {msg.isThoughtExpanded ? <i className="fas fa-chevron-up"></i> : <i className="fas fa-chevron-down"></i>}
                                            </button>
                                        </div>
                                        {msg.isThoughtExpanded && (
                                            <div className="p-3 text-xs text-gray-400 font-mono italic leading-relaxed border-t border-gray-700/30 whitespace-pre-wrap bg-gray-950/30">
                                                {msg.thought}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Message Bubble */}
                                <div className={`
                                    relative px-5 py-3 rounded-2xl text-sm md:text-base leading-relaxed shadow-md whitespace-pre-wrap min-w-[120px]
                                    ${isError 
                                        ? 'bg-red-900/50 border border-red-500 text-red-100 rounded-tl-none'
                                        : (isUser 
                                            ? 'bg-primary-600 text-white rounded-tr-none' 
                                            : 'bg-gray-800 text-gray-200 border border-gray-700 rounded-tl-none')
                                    }
                                `}>
                                    {isEditing ? (
                                        <div className="w-full min-w-[200px]">
                                            <textarea 
                                                value={editContent}
                                                onChange={(e) => setEditContent(e.target.value)}
                                                className="w-full bg-black/20 text-white rounded p-2 text-sm outline-none border border-white/20"
                                                rows={Math.max(3, editContent.split('\n').length)}
                                            />
                                            <div className="flex justify-end gap-2 mt-2">
                                                <button onClick={() => setEditingIndex(null)} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 text-xs">Batal</button>
                                                <button onClick={() => handleSaveEdit(idx)} className="px-3 py-1 bg-green-600 rounded hover:bg-green-500 text-white text-xs">Simpan</button>
                                            </div>
                                        </div>
                                    ) : (
                                        renderContent(activeContent)
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Message Controls (Bottom of bubble) */}
                        {showAdvancedControls && !isEditing && !isError && (
                            <div className={`flex items-center gap-2 mt-1 text-gray-500 text-xs opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? 'pr-12' : 'pl-12'}`}>
                                
                                {/* Branch Navigation */}
                                {candidates.length > 1 && (
                                    <div className="flex items-center bg-gray-800 rounded-md px-1 border border-gray-700">
                                        <button onClick={() => handleSwipe(idx, 'left')} className="p-1 hover:text-white"><i className="fas fa-chevron-left"></i></button>
                                        <span className="mx-2 font-mono">{currentIdx + 1}/{candidates.length}</span>
                                        <button onClick={() => handleSwipe(idx, 'right')} className="p-1 hover:text-white"><i className="fas fa-chevron-right"></i></button>
                                    </div>
                                )}

                                {/* Action Buttons */}
                                <div className="flex items-center gap-1 bg-gray-800/50 rounded-md p-1">
                                    <button onClick={() => handleStartEdit(idx)} className="p-1.5 hover:text-primary-400 transition" title="Edit Pesan">
                                        <i className="fas fa-pen"></i>
                                    </button>
                                    
                                    {!isUser && (
                                         <button onClick={() => handleRegenerate(idx)} className="p-1.5 hover:text-green-400 transition" title="Buat Ulang Jawaban">
                                            <i className="fas fa-sync-alt"></i>
                                        </button>
                                    )}

                                    <button onClick={() => handleDeleteMessage(msg.id)} className="p-1.5 hover:text-red-400 transition" title="Hapus Pesan">
                                        <i className="fas fa-trash"></i>
                                    </button>
                                </div>
                            </div>
                        )}
                        {/* Error Message Delete only */}
                        {isError && (
                             <div className="flex items-center gap-2 mt-1 text-gray-500 text-xs opacity-0 group-hover:opacity-100 transition-opacity pl-12">
                                <button onClick={() => handleDeleteMessage(msg.id)} className="p-1.5 hover:text-red-400 transition bg-gray-800/50 rounded-md" title="Hapus Pesan Error">
                                    <i className="fas fa-trash"></i>
                                </button>
                             </div>
                        )}

                    </div>
                </div>
            );
        })}
        
        {isLoading && (
             <div className="flex w-full justify-start">
                 <div className="flex max-w-[85%] gap-3">
                    <div className="shrink-0 w-8 h-8 rounded-full overflow-hidden mt-1 shadow-lg">
                        <img src={character.avatarUrl} className="w-full h-full object-cover" />
                    </div>
                    <div className="bg-gray-800 border border-gray-700 px-5 py-4 rounded-2xl rounded-tl-none flex items-center gap-2">
                        <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce delay-100"></div>
                        <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce delay-200"></div>
                    </div>
                 </div>
             </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 bg-gray-950 border-t border-gray-800 shrink-0">
        <div className="max-w-4xl mx-auto relative">
            <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                    }
                }}
                disabled={isLoading}
                placeholder={`Kirim pesan ke ${character.name}...`}
                className="w-full bg-gray-900 text-white rounded-xl border border-gray-700 p-4 pr-14 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none resize-none shadow-inner h-[80px] custom-scrollbar" 
            />
            <button 
                onClick={handleSendMessage}
                disabled={isLoading || !input.trim()}
                className="absolute right-3 bottom-3 p-2 bg-primary-600 hover:bg-primary-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-all shadow-lg"
            >
                <i className="fas fa-paper-plane"></i>
            </button>
        </div>
        <p className="text-center text-xs text-gray-600 mt-2">
            AI dapat membuat kesalahan. Periksa informasi penting.
        </p>
      </div>

      {/* LOREBOOK MODAL */}
      <LorebookModal 
          isOpen={isLorebookOpen}
          onClose={() => setIsLorebookOpen(false)}
          lorebook={character.lorebook || []}
          onSave={handleSaveLorebook}
          settings={settings}
      />

      {/* COLLABORATIVE BRIDGE (MODE C) */}
      <CollaborativeBridge 
          settings={settings}
          character={character}
          onInjectDirection={(direction) => handleSendMessage('', direction)}
          onInjectUserMessage={(message) => handleSendMessage(message)}
          lastCharacterMessage={messages.length > 0 && messages[messages.length - 1].role === 'model' ? messages[messages.length - 1] : null}
      />

      {/* CONFIRMATION MODAL */}
      <ConfirmModal 
          isOpen={confirmAction.isOpen}
          title={confirmAction.title}
          message={confirmAction.message}
          onConfirm={confirmAction.onConfirm}
          onCancel={closeConfirm}
      />
    </div>
  );
};

export default ChatPage;