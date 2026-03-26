
import React, { useState, useEffect, useRef } from 'react';
import { LorebookEntry, AppSettings } from '../types';
import { parseLorebook } from '../utils/parsers';
import { translateLorebookKeys } from '../services/geminiService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  lorebook: LorebookEntry[];
  onSave: (newLorebook: LorebookEntry[]) => void;
  settings: AppSettings; // Added settings prop for API access
}

const LorebookModal: React.FC<Props> = ({ isOpen, onClose, lorebook, onSave, settings }) => {
  const [entries, setEntries] = useState<LorebookEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
        // Clone to avoid direct mutation until saved
        setEntries(lorebook ? JSON.parse(JSON.stringify(lorebook)) : []);
        if (lorebook && lorebook.length > 0 && !selectedId) {
            setSelectedId(lorebook[0].id);
        }
    }
  }, [isOpen, lorebook]);

  if (!isOpen) return null;

  const handleAddNew = () => {
      const newEntry: LorebookEntry = {
          id: Date.now().toString(),
          keys: ['new keyword'],
          entry: '',
          enabled: true
      };
      setEntries([...entries, newEntry]);
      setSelectedId(newEntry.id);
  };

  const handleDelete = (id: string) => {
      const newEntries = entries.filter(e => e.id !== id);
      setEntries(newEntries);
      if (selectedId === id) {
          setSelectedId(newEntries.length > 0 ? newEntries[0].id : null);
      }
  };

  const handleUpdate = (id: string, field: keyof LorebookEntry, value: any) => {
      setEntries(entries.map(e => {
          if (e.id === id) {
              if (field === 'keys' && typeof value === 'string') {
                  return { ...e, keys: value.split(',').map(k => k.trim()) };
              }
              return { ...e, [field]: value };
          }
          return e;
      }));
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
          const text = await file.text();
          const json = JSON.parse(text);
          const importedEntries = parseLorebook(json);

          if (importedEntries.length > 0) {
              // Append imported entries to existing ones
              const newEntries = [...entries, ...importedEntries];
              setEntries(newEntries);
              // Select the first new entry
              setSelectedId(importedEntries[0].id);
              alert(`Berhasil mengimpor ${importedEntries.length} entri!`);
          } else {
              alert('File valid, tetapi tidak ditemukan entri lorebook.');
          }
      } catch (err) {
          console.error(err);
          alert('Gagal membaca file JSON. Pastikan formatnya benar.');
      } finally {
          e.target.value = '';
      }
  };

  const handleExport = () => {
      const json = JSON.stringify(entries, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Lorebook_Export_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
  };

  const handleAutoTranslate = async () => {
      if (entries.length === 0) return;
      if (!confirm("AI akan membaca semua keys (Bahasa Inggris) dan menambahkan sinonim Bahasa Indonesia. Proses ini mungkin memakan waktu beberapa detik. Lanjutkan?")) return;

      setIsTranslating(true);
      try {
          const updatedEntries = await translateLorebookKeys(entries, settings);
          setEntries(updatedEntries);
          alert("Selesai! Keys telah diperbarui dengan Bahasa Indonesia.");
      } catch (e: any) {
          alert(`Gagal: ${e.message}`);
      } finally {
          setIsTranslating(false);
      }
  };

  const selectedEntry = entries.find(e => e.id === selectedId);

  const handleSaveAndClose = () => {
      onSave(entries);
      onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-gray-850 border border-gray-750 w-full max-w-4xl h-[80vh] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-gray-750 bg-gray-900">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <i className="fas fa-book text-primary-500"></i> 
              Lorebook Editor
          </h2>
          <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white transition">Batal</button>
              <button onClick={handleSaveAndClose} className="px-6 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg font-bold shadow-lg shadow-primary-500/20">
                Simpan
              </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
            
            {/* Sidebar List */}
            <div className="w-1/3 border-r border-gray-750 bg-gray-900/50 flex flex-col">
                <div className="p-3 border-b border-gray-750 flex gap-2">
                    <button onClick={handleAddNew} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg flex items-center justify-center gap-2 text-sm transition border border-gray-700">
                        <i className="fas fa-plus"></i> Baru
                    </button>
                    <button onClick={() => fileInputRef.current?.click()} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg flex items-center justify-center gap-2 text-sm transition border border-gray-700" title="Impor JSON">
                        <i className="fas fa-file-import"></i> Impor
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleImport} accept=".json" className="hidden" />
                </div>
                
                {/* Tools Section */}
                <div className="p-3 border-b border-gray-750 space-y-2">
                    <button 
                        onClick={handleAutoTranslate} 
                        disabled={isTranslating}
                        className="w-full py-2 bg-gradient-to-r from-blue-600 to-primary-600 hover:from-blue-500 hover:to-primary-500 text-white rounded-lg flex items-center justify-center gap-2 text-xs font-bold transition shadow-lg"
                    >
                         {isTranslating ? <i className="fas fa-spinner animate-spin"></i> : <i className="fas fa-language"></i>}
                         Terjemahkan Keys ke Indo
                    </button>
                    <button onClick={handleExport} className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg flex items-center justify-center gap-2 text-xs transition border border-gray-700">
                         <i className="fas fa-download"></i> Ekspor Semua
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                    {entries.length === 0 && (
                        <p className="text-gray-500 text-xs text-center mt-10">Belum ada entry.</p>
                    )}
                    {entries.map(e => (
                        <button 
                            key={e.id} 
                            onClick={() => setSelectedId(e.id)}
                            className={`w-full text-left p-3 rounded-lg text-sm transition flex justify-between items-center group ${selectedId === e.id ? 'bg-primary-600/20 text-white border border-primary-500/50' : 'text-gray-400 hover:bg-gray-800'}`}
                        >
                            <span className="truncate font-mono">{e.keys[0] || 'Untitled'}</span>
                            <span className={`w-2 h-2 rounded-full ${e.enabled ? 'bg-green-500' : 'bg-gray-600'}`}></span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Editor Area */}
            <div className="w-2/3 bg-gray-950 p-6 overflow-y-auto custom-scrollbar">
                {selectedEntry ? (
                    <div className="space-y-6 animate-fade-in">
                        <div className="flex justify-between items-start">
                             <div>
                                 <label className="flex items-center gap-2 cursor-pointer select-none">
                                     <div className={`w-10 h-6 rounded-full p-1 transition-colors duration-300 ${selectedEntry.enabled ? 'bg-green-600' : 'bg-gray-700'}`} onClick={() => handleUpdate(selectedEntry.id, 'enabled', !selectedEntry.enabled)}>
                                         <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform duration-300 ${selectedEntry.enabled ? 'translate-x-4' : 'translate-x-0'}`}></div>
                                     </div>
                                     <span className="text-sm text-gray-300 font-bold">{selectedEntry.enabled ? 'Aktif' : 'Nonaktif'}</span>
                                 </label>
                             </div>
                             <button onClick={() => handleDelete(selectedEntry.id)} className="text-red-400 hover:text-red-300 text-sm flex items-center gap-1 hover:bg-red-900/20 px-3 py-1 rounded transition">
                                 <i className="fas fa-trash"></i> Hapus
                             </button>
                        </div>

                        <div className="space-y-2">
                            <label className="block text-sm font-bold text-gray-300">
                                Kata Kunci (Pemicu)
                                <span className="block text-xs font-normal text-gray-500 mt-1">Pisahkan dengan koma. Lore ini akan disuntikkan jika salah satu kata ini muncul di chat.</span>
                            </label>
                            <input 
                                type="text" 
                                value={selectedEntry.keys.join(', ')} 
                                onChange={(e) => handleUpdate(selectedEntry.id, 'keys', e.target.value)}
                                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none font-mono text-sm"
                                placeholder="contoh: kerajaan, raja arthur, excalibur"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="block text-sm font-bold text-gray-300">
                                Konten / Fakta
                                <span className="block text-xs font-normal text-gray-500 mt-1">Informasi yang akan diingat AI. Gunakan <code>{`{{char}}`}</code> dan <code>{`{{user}}`}</code> jika perlu.</span>
                            </label>
                            <textarea 
                                value={selectedEntry.entry}
                                onChange={(e) => handleUpdate(selectedEntry.id, 'entry', e.target.value)}
                                rows={10}
                                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none text-sm leading-relaxed"
                                placeholder="Tuliskan detail dunia, sejarah, atau fakta karakter di sini..."
                            />
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-gray-600">
                        <i className="fas fa-book-open text-5xl mb-4 opacity-30"></i>
                        <p>Pilih atau buat entry baru untuk mulai mengedit.</p>
                    </div>
                )}
            </div>
        </div>

      </div>
    </div>
  );
};

export default LorebookModal;