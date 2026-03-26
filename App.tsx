
import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { AppSettings, Character, DEFAULT_SETTINGS } from './types';
import { loadSettings, saveSettings, loadCharacters, saveCharacters, deleteChat } from './utils/storage';
import SettingsModal from './components/SettingsModal';
import CharacterCard from './components/CharacterCard';
import ChatPage from './pages/ChatPage';
import CharacterCreator from './pages/CharacterCreator';
import BridgeManager from './components/BridgeManager';
import ConfirmModal from './components/ConfirmModal';

interface LayoutProps {
  onOpenSettings: () => void;
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children, onOpenSettings }) => {
  const location = useLocation();

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#0f0f12]">
      {/* Sidebar / Navbar */}
      <nav className="w-full md:w-20 lg:w-64 bg-gray-950 border-r border-gray-800 flex flex-col shrink-0">
        <div className="p-4 flex items-center justify-center md:justify-start gap-3 border-b border-gray-800 h-16">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-blue-500 flex items-center justify-center text-white font-bold text-lg">
            G
          </div>
          <span className="font-bold text-lg tracking-tight hidden lg:block bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
            GeminiRP
          </span>
        </div>

        <div className="flex-1 overflow-y-auto py-4 flex flex-col gap-2 px-3">
          <Link to="/" className={`flex items-center gap-3 px-3 py-3 rounded-xl transition ${location.pathname === '/' ? 'bg-primary-600/20 text-primary-400' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
            <i className="fas fa-users text-lg w-6 text-center"></i>
            <span className="hidden lg:block font-medium">Karakter</span>
          </Link>
          
          <Link to="/create" className={`flex items-center gap-3 px-3 py-3 rounded-xl transition ${location.pathname === '/create' ? 'bg-primary-600/20 text-primary-400' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
            <i className="fas fa-plus-circle text-lg w-6 text-center"></i>
            <span className="hidden lg:block font-medium">Buat Baru</span>
          </Link>
        </div>

        <div className="p-4 border-t border-gray-800">
          <button 
            onClick={onOpenSettings}
            className="flex items-center gap-3 w-full px-3 py-3 rounded-xl text-gray-400 hover:bg-gray-800 hover:text-white transition group"
          >
            <i className="fas fa-cog text-lg w-6 text-center group-hover:rotate-90 transition-transform"></i>
            <span className="hidden lg:block font-medium">Pengaturan</span>
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 h-screen overflow-hidden relative">
        {children}
      </main>
    </div>
  );
};

// Home Page Component (Character List)
const HomePage = ({ characters, setCharacters }: { characters: Character[], setCharacters: (c: Character[]) => void }) => {
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteId(id);
  };

  const confirmDelete = async () => {
    if (deleteId) {
      const newChars = characters.filter(c => c.id !== deleteId);
      setCharacters(newChars);
      await saveCharacters(newChars);
      await deleteChat(deleteId);
      setDeleteId(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 md:p-8 relative">
      <header className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Pilih Karakter</h1>
          <p className="text-gray-400">Mulai petualangan roleplay baru Anda.</p>
        </div>
        <Link to="/create" className="bg-primary-600 hover:bg-primary-500 text-white px-5 py-2 rounded-lg font-bold transition shadow-lg shadow-primary-500/20 flex items-center gap-2">
          <i className="fas fa-plus"></i> <span className="hidden sm:inline">Buat Karakter</span>
        </Link>
      </header>

      {characters.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-96 text-gray-500 border-2 border-dashed border-gray-800 rounded-2xl">
          <i className="fas fa-ghost text-5xl mb-4 opacity-50"></i>
          <p className="text-lg">Belum ada karakter.</p>
          <Link to="/create" className="mt-2 text-primary-500 hover:underline">Buat satu sekarang!</Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
          {characters.map(char => (
            <Link key={char.id} to={`/chat/${char.id}`}>
               <CharacterCard 
                  character={char} 
                  onClick={() => {}} 
                  onDelete={(e) => handleDeleteClick(e, char.id)}
                />
            </Link>
          ))}
        </div>
      )}

      <ConfirmModal 
        isOpen={!!deleteId}
        title="Hapus Karakter"
        message="Apakah Anda yakin ingin menghapus karakter ini beserta semua riwayat chatnya? Tindakan ini tidak dapat dibatalkan."
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
};

const App: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
        setSettings(loadSettings());
        const chars = await loadCharacters();
        setCharacters(chars);
        setIsLoading(false);
    };
    init();
  }, []);

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  };
  
  const handleReloadData = async () => {
      const chars = await loadCharacters();
      setCharacters(chars);
  }

  if (isLoading) {
      return (
          <div className="min-h-screen bg-[#0f0f12] flex flex-col items-center justify-center text-white gap-4">
              <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="animate-pulse">Memuat Database...</p>
          </div>
      )
  }

  return (
    <HashRouter>
      <BridgeManager settings={settings} />
      <Layout onOpenSettings={() => setIsSettingsOpen(true)}>
        <Routes>
          <Route path="/" element={<HomePage characters={characters} setCharacters={setCharacters} />} />
          <Route 
            path="/create" 
            element={
              <CharacterCreator 
                settings={settings}
                onSave={async (newChars) => {
                  setCharacters(newChars);
                  await saveCharacters(newChars);
                }} 
              />
            } 
          />
          <Route path="/chat/:charId" element={<ChatPage settings={settings} />} />
        </Routes>
      </Layout>
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        settings={settings}
        onSave={handleSaveSettings}
        onDataRestored={handleReloadData}
      />
    </HashRouter>
  );
};

export default App;
