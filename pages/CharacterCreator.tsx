
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Character, LorebookEntry, AppSettings } from '../types';
import { loadCharacters } from '../utils/storage';
import { parseTavernCharacter, extractMetadataFromPNG } from '../utils/parsers';
import { translateLorebookKeys } from '../services/geminiService';

interface Props {
  onSave: (chars: Character[]) => Promise<void>;
  settings: AppSettings;
}

const CharacterCreator: React.FC<Props> = ({ onSave, settings }) => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'create' | 'import'>('create');
  const [isLoading, setIsLoading] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  
  // Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [personality, setPersonality] = useState('');
  const [firstMessage, setFirstMessage] = useState('');
  const [scenario, setScenario] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  
  // World Info State
  const [lorebook, setLorebook] = useState<LorebookEntry[]>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const newChar: Character = {
      id: Date.now().toString(),
      name,
      description,
      personality,
      firstMessage,
      scenario,
      avatarUrl: avatarUrl || `https://ui-avatars.com/api/?name=${name}`,
      lorebook: lorebook
    };

    try {
        const currentChars = await loadCharacters();
        await onSave([...currentChars, newChar]);
        navigate('/');
    } catch (e) {
        alert('Gagal menyimpan karakter.');
    } finally {
        setIsLoading(false);
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsLoading(true);

    try {
        let jsonData: any = null;
        let importedAvatarUrl: string = '';

        // 1. Check if PNG
        if (file.type === 'image/png' || file.name.endsWith('.png')) {
            // Read metadata
            jsonData = await extractMetadataFromPNG(file);
            // Create object URL for the image itself
            const reader = new FileReader();
            await new Promise<void>((resolve) => {
                reader.onload = (evt) => {
                    importedAvatarUrl = evt.target?.result as string;
                    resolve();
                };
                reader.readAsDataURL(file);
            });
        } 
        // 2. Check if JSON
        else if (file.type === 'application/json' || file.name.endsWith('.json') || file.name.endsWith('.jsonl')) {
             const text = await file.text();
             if (text.trim().startsWith('{')) {
                 try {
                     jsonData = JSON.parse(text);
                 } catch {
                     const lines = text.split('\n');
                     jsonData = JSON.parse(lines[0]);
                 }
             }
        }

        if (jsonData) {
            const parsedChar = parseTavernCharacter(jsonData);
            if (parsedChar) {
                setName(parsedChar.name);
                setDescription(parsedChar.description);
                setPersonality(parsedChar.personality);
                setFirstMessage(parsedChar.firstMessage);
                setScenario(parsedChar.scenario || '');
                // Note: Basic parser doesn't extract Character Book yet, 
                // but we initialize empty array for now.
                setLorebook([]); 
                
                if (importedAvatarUrl) {
                    setAvatarUrl(importedAvatarUrl);
                } else {
                    setAvatarUrl(parsedChar.avatarUrl);
                }
                
                setMode('create'); // Switch to editor
                alert('Karakter berhasil diimpor! Silakan periksa detailnya.');
            } else {
                alert('Format data tidak valid atau tidak ditemukan data karakter.');
            }
        } else {
            // If it was a PNG but no metadata found
            if (file.type === 'image/png' && importedAvatarUrl) {
                alert('File PNG ini tidak memiliki metadata karakter (V1/V2). Hanya gambar yang akan digunakan.');
                setAvatarUrl(importedAvatarUrl);
                setMode('create');
            } else {
                alert('Gagal mengekstrak data dari file.');
            }
        }

    } catch (err) {
        console.error(err);
        alert('Terjadi kesalahan saat membaca file.');
    } finally {
        setIsLoading(false);
        e.target.value = ''; // Reset input
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if(file) {
          const reader = new FileReader();
          reader.onloadend = () => {
              setAvatarUrl(reader.result as string);
          }
          reader.readAsDataURL(file);
      }
  }

  // --- World Info Handlers ---
  const addLorebookEntry = () => {
    setLorebook([...lorebook, { id: Date.now().toString(), keys: [], entry: '', enabled: true }]);
  };

  const updateLorebookEntry = (index: number, field: 'keys' | 'entry', value: string) => {
    const newLorebook = [...lorebook];
    if (field === 'keys') {
        newLorebook[index].keys = value.split(',').map(k => k.trim());
    } else {
        newLorebook[index].entry = value;
    }
    setLorebook(newLorebook);
  };

  const removeLorebookEntry = (index: number) => {
    const newLorebook = lorebook.filter((_, i) => i !== index);
    setLorebook(newLorebook);
  };

  const handleAutoTranslateLorebook = async () => {
      if (lorebook.length === 0) return;
      if (!confirm("AI akan menerjemahkan/menambahkan sinonim Bahasa Indonesia untuk semua Keys Lorebook. Proses ini menggunakan API Key Anda. Lanjutkan?")) return;

      setIsTranslating(true);
      try {
          const updated = await translateLorebookKeys(lorebook, settings);
          setLorebook(updated);
          alert("Berhasil! Keys telah diperbarui.");
      } catch (e: any) {
          alert(`Gagal menerjemahkan: ${e.message}`);
      } finally {
          setIsTranslating(false);
      }
  };

  return (
    <div className="h-full overflow-y-auto p-6 md:p-12 max-w-4xl mx-auto custom-scrollbar">
      <div className="flex gap-4 mb-8 border-b border-gray-800 pb-4 sticky top-0 bg-[#0f0f12] z-10 pt-2">
        <button 
            onClick={() => setMode('create')}
            className={`text-xl font-bold pb-2 border-b-2 transition ${mode === 'create' ? 'border-primary-500 text-white' : 'border-transparent text-gray-500'}`}
        >
            <i className="fas fa-edit mr-2"></i> Editor Manual
        </button>
        <button 
            onClick={() => setMode('import')}
            className={`text-xl font-bold pb-2 border-b-2 transition ${mode === 'import' ? 'border-primary-500 text-white' : 'border-transparent text-gray-500'}`}
        >
            <i className="fas fa-file-import mr-2"></i> Impor Kartu
        </button>
      </div>

      {mode === 'import' ? (
        <div className="flex flex-col items-center justify-center min-h-[50vh] bg-gray-900/50 border-2 border-dashed border-gray-700 rounded-2xl p-10 text-center animate-fade-in">
            {isLoading ? (
                <div className="text-primary-500 animate-pulse text-xl font-bold">Memproses File...</div>
            ) : (
                <>
                    <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mb-6">
                        <i className="fas fa-id-card text-4xl text-primary-500"></i>
                    </div>
                    <h3 className="text-2xl font-bold text-white mb-2">Impor Kartu Karakter</h3>
                    <p className="text-gray-400 mb-8 max-w-md">
                        Drag & Drop atau pilih file. Mendukung: <br/>
                        <span className="text-primary-400 font-mono text-sm bg-gray-800 px-2 py-1 rounded mx-1">.png (Tavern Card)</span>
                        <span className="text-primary-400 font-mono text-sm bg-gray-800 px-2 py-1 rounded mx-1">.json</span>
                    </p>
                    
                    <label className="bg-primary-600 hover:bg-primary-500 text-white px-8 py-4 rounded-xl cursor-pointer transition shadow-lg shadow-primary-500/20 font-bold flex items-center gap-3">
                        <input type="file" accept=".png,.json,.jsonl" onChange={handleFileImport} className="hidden" />
                        <i className="fas fa-upload"></i> Pilih File
                    </label>
                </>
            )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6 animate-fade-in pb-10">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Left Column: Avatar */}
                <div className="md:col-span-1">
                    <label className="block text-sm font-medium text-gray-300 mb-2">Avatar</label>
                    <div className="aspect-[3/4] bg-gray-800 rounded-xl overflow-hidden relative border-2 border-dashed border-gray-700 hover:border-gray-500 transition group">
                        {avatarUrl ? (
                            <img src={avatarUrl} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-gray-500">
                                <i className="fas fa-image text-3xl mb-2"></i>
                                <span className="text-sm">Klik untuk Upload</span>
                            </div>
                        )}
                        <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                    </div>
                </div>

                {/* Right Column: Details */}
                <div className="md:col-span-2 space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-white mb-1">Nama Karakter</label>
                        <input required value={name} onChange={e => setName(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none placeholder-gray-600" placeholder="Contoh: Elfie Mistletoe" />
                    </div>
                    
                    <div>
                        <label className="block text-sm font-bold text-white mb-1">Deskripsi Singkat</label>
                        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none placeholder-gray-600" placeholder="Penjelasan fisik, umur, ras, dan latar belakang singkat... (Opsional)" />
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-white mb-1">Personalitas</label>
                        <textarea value={personality} onChange={e => setPersonality(e.target.value)} rows={4} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none placeholder-gray-600" placeholder="Sifat, Kebiasaan, Gaya Bicara... (Opsional)" />
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-bold text-white mb-1">Pesan Pertama (First Message)</label>
                    <textarea required value={firstMessage} onChange={e => setFirstMessage(e.target.value)} rows={5} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none placeholder-gray-600" />
                </div>
                
                <div>
                    <label className="block text-sm font-bold text-white mb-1">Skenario</label>
                    <textarea value={scenario} onChange={e => setScenario(e.target.value)} rows={3} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none placeholder-gray-600" />
                </div>
            </div>

            {/* WORLD INFO EDITOR SECTION */}
            <div className="border-t border-gray-800 pt-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
                    <div>
                         <h3 className="text-lg font-bold text-white"><i className="fas fa-book mr-2 text-primary-500"></i> World Info (Lorebook)</h3>
                         <p className="text-gray-400 text-sm">Tambahkan detail rahasia, sejarah, atau fakta dunia.</p>
                    </div>
                    <div className="flex gap-2">
                        <button 
                            type="button" 
                            onClick={handleAutoTranslateLorebook} 
                            disabled={isTranslating || lorebook.length === 0}
                            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm transition flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isTranslating ? <i className="fas fa-spinner animate-spin"></i> : <i className="fas fa-language"></i>}
                            Terjemahkan Keys
                        </button>
                        <button type="button" onClick={addLorebookEntry} className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm transition">
                            <i className="fas fa-plus mr-1"></i> Tambah Entry
                        </button>
                    </div>
                </div>

                <div className="space-y-4">
                    {lorebook.length === 0 && (
                        <div className="text-center p-6 border border-dashed border-gray-800 rounded-xl text-gray-500">
                            Belum ada entri World Info. Klik "Tambah Entry" untuk membuat Lorebook.
                        </div>
                    )}
                    {lorebook.map((info, index) => (
                        <div key={info.id} className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 animate-fade-in relative group">
                            <button 
                                type="button"
                                onClick={() => removeLorebookEntry(index)}
                                className="absolute top-2 right-2 text-gray-600 hover:text-red-500 p-2 transition opacity-0 group-hover:opacity-100"
                            >
                                <i className="fas fa-trash"></i>
                            </button>
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div className="md:col-span-1">
                                    <label className="block text-xs font-bold text-gray-400 mb-1">Kata Kunci (Pisahkan koma)</label>
                                    <input 
                                        type="text" 
                                        value={info.keys.join(', ')} 
                                        onChange={(e) => updateLorebookEntry(index, 'keys', e.target.value)}
                                        className="w-full bg-gray-950 border border-gray-700 rounded p-2 text-sm text-white focus:ring-1 focus:ring-primary-500 outline-none font-mono" 
                                        placeholder="Misal: Kerajaan, Raja Arthur"
                                    />
                                </div>
                                <div className="md:col-span-3">
                                    <label className="block text-xs font-bold text-gray-400 mb-1">Deskripsi / Lore</label>
                                    <textarea 
                                        value={info.entry} 
                                        onChange={(e) => updateLorebookEntry(index, 'entry', e.target.value)}
                                        rows={2}
                                        className="w-full bg-gray-950 border border-gray-700 rounded p-2 text-sm text-white focus:ring-1 focus:ring-primary-500 outline-none" 
                                        placeholder="Detail yang akan disisipkan ke AI saat kata kunci terdeteksi..."
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex justify-end pt-6 border-t border-gray-800">
                <button type="submit" disabled={isLoading} className="bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 hover:to-primary-400 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-primary-500/20 transform active:scale-95 transition disabled:opacity-50">
                    <i className="fas fa-save mr-2"></i> {isLoading ? 'Menyimpan...' : 'Simpan Karakter'}
                </button>
            </div>
        </form>
      )}
    </div>
  );
};

export default CharacterCreator;
