
import React from 'react';
import { AppSettings, AVAILABLE_MODELS } from '../types';
import { exportAllData, importAllData } from '../utils/storage';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (s: AppSettings) => void;
  onDataRestored?: () => void;
}

const SettingsModal: React.FC<Props> = ({ isOpen, onClose, settings, onSave, onDataRestored }) => {
  const [localSettings, setLocalSettings] = React.useState<AppSettings>(settings);
  const [backupStatus, setBackupStatus] = React.useState('');
  const [externalModels, setExternalModels] = React.useState<{id: string, name: string}[]>([]);
  const [isLoadingModels, setIsLoadingModels] = React.useState(false);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setLocalSettings(settings);
  }, [settings, isOpen]);

  // Effect to fetch models if External Provider is selected
  React.useEffect(() => {
      if (isOpen) {
          if (localSettings.serviceProvider === 'sumopod') {
              fetchModels('sumopod');
          } else if (localSettings.serviceProvider === 'electronhub') {
              fetchModels('electronhub');
          } else if (localSettings.serviceProvider === 'glm') {
              fetchModels('glm');
          } else if (localSettings.serviceProvider === 'byteplus') {
              fetchModels('byteplus');
          } else if (localSettings.serviceProvider === 'nvidia') {
              fetchModels('nvidia');
          } else if (localSettings.serviceProvider === 'custom') {
              fetchModels('custom');
          }
      }
  }, [localSettings.serviceProvider, localSettings.sumoPodApiKey, localSettings.electronHubApiKey, localSettings.glmApiKey, localSettings.byteplusApiKey, localSettings.nvidiaApiKey, localSettings.customApiKey, localSettings.customEndpoint, isOpen]);

  const fetchModels = async (provider: 'sumopod' | 'electronhub' | 'glm' | 'byteplus' | 'nvidia' | 'custom') => {
      let apiKey = "";
      let baseUrl = "";
      
      if (provider === 'sumopod') {
          apiKey = localSettings.sumoPodApiKey;
          baseUrl = 'https://ai.sumopod.com/v1/models';
      } else if (provider === 'electronhub') {
          apiKey = localSettings.electronHubApiKey;
          baseUrl = 'https://api.electronhub.ai/v1/models';
      } else if (provider === 'glm') {
          apiKey = localSettings.glmApiKey;
          baseUrl = 'https://open.bigmodel.cn/api/paas/v4/models';
      } else if (provider === 'byteplus') {
          apiKey = localSettings.byteplusApiKey;
          baseUrl = 'https://ark.byteplusapi.com/api/v3/models';
      } else if (provider === 'nvidia') {
          apiKey = localSettings.nvidiaApiKey;
          baseUrl = 'https://integrate.api.nvidia.com/v1/models';
      } else if (provider === 'custom') {
          apiKey = localSettings.customApiKey;
          // Try to derive the models endpoint from the chat completions endpoint
          baseUrl = localSettings.customEndpoint.replace('/chat/completions', '/models');
      }

      if (!apiKey) return;
      
      setIsLoadingModels(true);
      setFetchError(null);
      
      try {
          const headers: any = {
              'Accept': 'application/json'
          };
          if (apiKey) {
              headers['Authorization'] = `Bearer ${apiKey}`;
          }

          const res = await fetch(baseUrl, {
              headers: headers
          });
          
          if (res.ok) {
              const data = await res.json();
              // Standard OpenAI format: { data: [{ id: '...', ... }] }
              if (Array.isArray(data.data)) {
                  const models = data.data.map((m: any) => ({
                      id: m.id,
                      name: m.id // Often API just gives ID
                  })).sort((a: any, b: any) => a.id.localeCompare(b.id));
                  
                  setExternalModels(models);
                  
                  // If current model is not in list (e.g. was switched from Google), default to first available
                  const currentInList = models.find((m: any) => m.id === localSettings.model);
                  if (!currentInList && models.length > 0) {
                      setLocalSettings(prev => ({ ...prev, model: models[0].id }));
                  }
              } else {
                   setExternalModels([]);
                   setFetchError('Format respon server tidak dikenali.');
              }
          } else {
              setExternalModels([]);
              // For NVIDIA/CORS issues, don't show a scary error, just allow manual input
              if (provider === 'nvidia') {
                  setFetchError(null); 
              } else {
                  setFetchError(`Gagal mengambil model (${res.status}). Gunakan input manual.`);
              }
          }
      } catch (e: any) {
          // Silent fail for CORS/Network issues to allow manual input gracefully
          console.warn(`Failed to fetch ${provider} models:`, e.message);
          setExternalModels([]);
          if (provider === 'nvidia') {
               setFetchError(null); // Just suppress error for NVIDIA to show manual input cleanly
          } else {
               setFetchError(`Gagal terhubung (${e.message}). Gunakan input manual.`);
          }
      } finally {
          setIsLoadingModels(false);
      }
  };

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

  const handleBackup = async () => {
      setBackupStatus('Membuat backup...');
      try {
          const json = await exportAllData();
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `GeminiRP_Backup_${new Date().toISOString().slice(0,10)}.json`;
          a.click();
          URL.revokeObjectURL(url);
          setBackupStatus('Backup berhasil diunduh!');
          setTimeout(() => setBackupStatus(''), 3000);
      } catch (e) {
          setBackupStatus('Gagal membuat backup.');
      }
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if(!file) return;
      
      if(!confirm("PERINGATAN: Tindakan ini akan menimpa semua data saat ini dengan data dari file backup. Lanjutkan?")) {
          e.target.value = '';
          return;
      }

      setBackupStatus('Memulihkan data...');
      try {
          const text = await file.text();
          await importAllData(text);
          setBackupStatus('Data berhasil dipulihkan!');
          alert('Data berhasil dipulihkan!');
          if(onDataRestored) onDataRestored();
          onClose();
      } catch (e) {
          alert('Gagal memulihkan data: File korup atau format salah.');
          setBackupStatus('');
      }
      e.target.value = '';
  }

  const formatTokenCount = (num: number) => {
    if (num >= 1000000) return (num / 1000000) + "M Token";
    if (num >= 1000) return (num / 1000) + "k Token";
    return num + " Token";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-gray-850 border border-gray-750 w-full max-w-2xl rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        
        <div className="flex justify-between items-center p-6 border-b border-gray-750">
          <h2 className="text-xl font-bold text-white"><i className="fas fa-cog mr-2 text-primary-500"></i> Pengaturan Global</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition">
            <i className="fas fa-times text-xl"></i>
          </button>
        </div>

        <div className="overflow-y-auto p-6 space-y-6 flex-1 custom-scrollbar">
          
          {/* Service Provider Section */}
          <div className="space-y-3 bg-gray-900/50 p-4 rounded-xl border border-gray-700">
             <h3 className="text-sm font-bold text-primary-400 uppercase tracking-widest"><i className="fas fa-server mr-2"></i> Penyedia Layanan</h3>
             
             <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                 <button 
                    onClick={() => setLocalSettings({...localSettings, serviceProvider: 'google', model: 'gemini-3-flash-preview'})}
                    className={`py-3 px-2 rounded-lg font-bold border transition text-sm flex items-center justify-center ${localSettings.serviceProvider === 'google' ? 'bg-primary-600 border-primary-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}
                 >
                     <i className="fab fa-google mr-2"></i> Gemini
                 </button>
                 <button 
                    onClick={() => setLocalSettings({...localSettings, serviceProvider: 'sumopod'})}
                    className={`py-3 px-2 rounded-lg font-bold border transition text-sm flex items-center justify-center ${localSettings.serviceProvider === 'sumopod' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}
                 >
                     <i className="fas fa-cloud mr-2"></i> SumoPod
                 </button>
                 <button 
                    onClick={() => setLocalSettings({...localSettings, serviceProvider: 'electronhub'})}
                    className={`py-3 px-2 rounded-lg font-bold border transition text-sm flex items-center justify-center ${localSettings.serviceProvider === 'electronhub' ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}
                 >
                     <i className="fas fa-bolt mr-2"></i> ElectronHub
                 </button>
                 <button 
                    onClick={() => setLocalSettings({...localSettings, serviceProvider: 'glm'})}
                    className={`py-3 px-2 rounded-lg font-bold border transition text-sm flex items-center justify-center ${localSettings.serviceProvider === 'glm' ? 'bg-amber-600 border-amber-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}
                 >
                     <i className="fas fa-robot mr-2"></i> GLM
                 </button>
                 <button 
                    onClick={() => setLocalSettings({...localSettings, serviceProvider: 'byteplus'})}
                    className={`py-3 px-2 rounded-lg font-bold border transition text-sm flex items-center justify-center ${localSettings.serviceProvider === 'byteplus' ? 'bg-rose-600 border-rose-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}
                 >
                     <i className="fas fa-cube mr-2"></i> BytePlus
                 </button>
                 <button 
                    onClick={() => setLocalSettings({...localSettings, serviceProvider: 'nvidia'})}
                    className={`py-3 px-2 rounded-lg font-bold border transition text-sm flex items-center justify-center ${localSettings.serviceProvider === 'nvidia' ? 'bg-green-600 border-green-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}
                 >
                     <i className="fas fa-microchip mr-2"></i> NVIDIA
                 </button>
                 <button 
                    onClick={() => setLocalSettings({...localSettings, serviceProvider: 'custom'})}
                    className={`py-3 px-2 rounded-lg font-bold border transition text-sm flex items-center justify-center ${localSettings.serviceProvider === 'custom' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}
                 >
                     <i className="fas fa-link mr-2"></i> Custom
                 </button>
             </div>

             {/* API Key Input for Custom Provider */}
             {localSettings.serviceProvider === 'custom' && (
                 <div className="mt-3 space-y-4 animate-fade-in">
                     <div className="space-y-2">
                         <label className="block text-sm font-medium text-gray-300">Custom Endpoint URL</label>
                         <p className="text-xs text-gray-500">URL lengkap menuju endpoint chat completions (contoh: http://bore.pub:1482/v1/chat/completions)</p>
                         <input
                             type="text"
                             value={localSettings.customEndpoint}
                             onChange={(e) => setLocalSettings({...localSettings, customEndpoint: e.target.value})}
                             className="w-full bg-gray-950 border border-gray-750 rounded-lg p-3 text-white focus:ring-2 focus:ring-purple-500 outline-none font-mono text-sm"
                             placeholder="http://.../v1/chat/completions"
                         />
                     </div>
                     <div className="space-y-2">
                         <label className="block text-sm font-medium text-gray-300">Custom API Key (Opsional)</label>
                         <div className="flex gap-2">
                            <input
                                type="password"
                                value={localSettings.customApiKey}
                                onChange={(e) => setLocalSettings({...localSettings, customApiKey: e.target.value})}
                                className="w-full bg-gray-950 border border-gray-750 rounded-lg p-3 text-white focus:ring-2 focus:ring-purple-500 outline-none font-mono text-sm"
                                placeholder="sk-..."
                            />
                            <button 
                                onClick={() => fetchModels('custom')}
                                className="px-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg border border-gray-600"
                                title="Refresh Models"
                            >
                                <i className={`fas fa-sync ${isLoadingModels ? 'animate-spin' : ''}`}></i>
                            </button>
                         </div>
                     </div>
                 </div>
             )}

             {/* API Key Input for SumoPod */}
             {localSettings.serviceProvider === 'sumopod' && (
                 <div className="mt-3 space-y-2 animate-fade-in">
                     <label className="block text-sm font-medium text-gray-300">SumoPod API Key</label>
                     <div className="flex gap-2">
                        <input
                            type="password"
                            value={localSettings.sumoPodApiKey}
                            onChange={(e) => setLocalSettings({...localSettings, sumoPodApiKey: e.target.value})}
                            className="w-full bg-gray-950 border border-gray-750 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                            placeholder="sk-..."
                        />
                        <button 
                            onClick={() => fetchModels('sumopod')}
                            className="px-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg border border-gray-600"
                            title="Refresh Models"
                        >
                            <i className={`fas fa-sync ${isLoadingModels ? 'animate-spin' : ''}`}></i>
                        </button>
                     </div>
                 </div>
             )}

             {/* API Key Input for ElectronHub */}
             {localSettings.serviceProvider === 'electronhub' && (
                 <div className="mt-3 space-y-2 animate-fade-in">
                     <label className="block text-sm font-medium text-gray-300">ElectronHub API Key</label>
                     <div className="flex gap-2">
                        <input
                            type="password"
                            value={localSettings.electronHubApiKey}
                            onChange={(e) => setLocalSettings({...localSettings, electronHubApiKey: e.target.value})}
                            className="w-full bg-gray-950 border border-gray-750 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 outline-none font-mono text-sm"
                            placeholder="ek-..."
                        />
                        <button 
                            onClick={() => fetchModels('electronhub')}
                            className="px-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg border border-gray-600"
                            title="Refresh Models"
                        >
                            <i className={`fas fa-sync ${isLoadingModels ? 'animate-spin' : ''}`}></i>
                        </button>
                     </div>
                 </div>
             )}

             {/* API Key Input for GLM */}
             {localSettings.serviceProvider === 'glm' && (
                 <div className="mt-3 space-y-2 animate-fade-in">
                     <label className="block text-sm font-medium text-gray-300">GLM (BigModel) API Key</label>
                     <div className="flex gap-2">
                        <input
                            type="password"
                            value={localSettings.glmApiKey}
                            onChange={(e) => setLocalSettings({...localSettings, glmApiKey: e.target.value})}
                            className="w-full bg-gray-950 border border-gray-750 rounded-lg p-3 text-white focus:ring-2 focus:ring-amber-500 outline-none font-mono text-sm"
                            placeholder="id.secret"
                        />
                        <button 
                            onClick={() => fetchModels('glm')}
                            className="px-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg border border-gray-600"
                            title="Refresh Models"
                        >
                            <i className={`fas fa-sync ${isLoadingModels ? 'animate-spin' : ''}`}></i>
                        </button>
                     </div>
                 </div>
             )}

             {/* API Key Input for BytePlus */}
             {localSettings.serviceProvider === 'byteplus' && (
                 <div className="mt-3 space-y-2 animate-fade-in">
                     <label className="block text-sm font-medium text-gray-300">BytePlus (Ark) API Key</label>
                     <div className="flex gap-2">
                        <input
                            type="password"
                            value={localSettings.byteplusApiKey}
                            onChange={(e) => setLocalSettings({...localSettings, byteplusApiKey: e.target.value})}
                            className="w-full bg-gray-950 border border-gray-750 rounded-lg p-3 text-white focus:ring-2 focus:ring-rose-500 outline-none font-mono text-sm"
                            placeholder="uuid-..."
                        />
                        <button 
                            onClick={() => fetchModels('byteplus')}
                            className="px-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg border border-gray-600"
                            title="Refresh Models"
                        >
                            <i className={`fas fa-sync ${isLoadingModels ? 'animate-spin' : ''}`}></i>
                        </button>
                     </div>
                 </div>
             )}

             {/* API Key Input for NVIDIA */}
             {localSettings.serviceProvider === 'nvidia' && (
                 <div className="mt-3 space-y-2 animate-fade-in">
                     <label className="block text-sm font-medium text-gray-300">NVIDIA API Key</label>
                     <div className="flex gap-2">
                        <input
                            type="password"
                            value={localSettings.nvidiaApiKey}
                            onChange={(e) => setLocalSettings({...localSettings, nvidiaApiKey: e.target.value})}
                            className="w-full bg-gray-950 border border-gray-750 rounded-lg p-3 text-white focus:ring-2 focus:ring-green-500 outline-none font-mono text-sm"
                            placeholder="nvapi-..."
                        />
                        <button 
                            onClick={() => fetchModels('nvidia')}
                            className="px-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg border border-gray-600"
                            title="Refresh Models"
                        >
                            <i className={`fas fa-sync ${isLoadingModels ? 'animate-spin' : ''}`}></i>
                        </button>
                     </div>
                 </div>
             )}
          </div>

          <div className="h-px bg-gray-750 my-2"></div>

          {/* User Profile */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">Nama Pengguna (User Name)</label>
            <input
              type="text"
              value={localSettings.userName || 'User'}
              onChange={(e) => setLocalSettings({...localSettings, userName: e.target.value})}
              className="w-full bg-gray-950 border border-gray-750 rounded-lg p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none"
              placeholder="Bagaimana AI memanggil Anda?"
            />
          </div>

          {/* Model Selection */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
                <label className="block text-sm font-medium text-gray-300">Model AI</label>
                {isLoadingModels && <span className="text-xs text-blue-400 animate-pulse">Mengambil daftar model...</span>}
            </div>
            
            {/* Logic: 
                - If Google: Show static list.
                - If SumoPod/ElectronHub/GLM/BytePlus/NVIDIA AND models fetched successfully: Show dropdown.
                - If SumoPod/ElectronHub/GLM/BytePlus/NVIDIA AND models failed: Show Text Input (Manual).
            */}
            {localSettings.serviceProvider === 'google' ? (
                <select
                    value={localSettings.model}
                    onChange={(e) => setLocalSettings({...localSettings, model: e.target.value})}
                    className="w-full bg-gray-950 border border-gray-750 rounded-lg p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none"
                >
                    {AVAILABLE_MODELS.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                </select>
            ) : (
                // External Provider Logic
                externalModels.length > 0 ? (
                    <select
                        value={localSettings.model}
                        onChange={(e) => setLocalSettings({...localSettings, model: e.target.value})}
                        className={`w-full bg-gray-950 border border-gray-750 rounded-lg p-3 text-white focus:ring-2 outline-none ${
                            localSettings.serviceProvider === 'glm' ? 'focus:ring-amber-500' : 
                            localSettings.serviceProvider === 'byteplus' ? 'focus:ring-rose-500' :
                            localSettings.serviceProvider === 'nvidia' ? 'focus:ring-green-500' :
                            'focus:ring-blue-500'}`}
                        disabled={isLoadingModels}
                    >
                        {externalModels.map(m => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                    </select>
                ) : (
                    <div className="space-y-1">
                        <input
                            type="text"
                            value={localSettings.model}
                            onChange={(e) => setLocalSettings({...localSettings, model: e.target.value})}
                            className="w-full bg-gray-950 border border-red-500/50 rounded-lg p-3 text-white focus:ring-2 focus:ring-red-500 outline-none placeholder-gray-500"
                            placeholder="Ketik ID Model secara manual (contoh: moonshotai/kimi-k2.5)"
                        />
                        {fetchError && <p className="text-xs text-red-400"><i className="fas fa-exclamation-triangle mr-1"></i> {fetchError}</p>}
                    </div>
                )
            )}
          </div>

          {/* Context Window (Tokens) */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <label className="block text-sm font-medium text-gray-300">Ukuran Konteks (Memori)</label>
              <span className="text-sm text-primary-500 font-bold">{formatTokenCount(localSettings.contextLimit)}</span>
            </div>
            
            <select
              value={localSettings.contextLimit}
              onChange={(e) => setLocalSettings({...localSettings, contextLimit: parseInt(e.target.value)})}
              className="w-full bg-gray-950 border border-gray-750 rounded-lg p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none"
            >
                <option value={8192}>8k Token (Standar)</option>
                <option value={32768}>32k Token (Panjang)</option>
                <option value={128000}>128k Token (Sangat Panjang)</option>
                <option value={500000}>500k Token (Masif)</option>
                <option value={1000000}>1M Token (Maksimal Gemini)</option>
            </select>
            <p className="text-xs text-gray-500">
                Menentukan seberapa banyak riwayat percakapan yang dikirim ke AI. 
            </p>
          </div>

           {/* Temperature */}
           <div className="space-y-2">
            <div className="flex justify-between">
              <label className="block text-sm font-medium text-gray-300">Kreativitas (Temperature)</label>
              <span className="text-sm text-primary-500 font-bold">{localSettings.temperature}</span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={localSettings.temperature}
              onChange={(e) => setLocalSettings({...localSettings, temperature: parseFloat(e.target.value)})}
              className="w-full h-2 bg-gray-750 rounded-lg appearance-none cursor-pointer accent-primary-500"
            />
          </div>

          {/* Jailbreak / System Prompt */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">
              Instruksi Sistem / Jailbreak
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Model akan dipaksa mengikuti instruksi ini. Gunakan placeholder <code>{`{{char}}`}</code> dan <code>{`{{user}}`}</code>.
            </p>
            <textarea
              value={localSettings.systemPrompt}
              onChange={(e) => setLocalSettings({...localSettings, systemPrompt: e.target.value})}
              rows={6}
              className="w-full bg-gray-950 border border-gray-750 rounded-lg p-3 text-sm text-gray-200 font-mono focus:ring-2 focus:ring-primary-500 outline-none resize-y"
            />
          </div>
          
          <div className="h-px bg-gray-750 my-4"></div>

          {/* Data Management */}
          <div className="space-y-3">
             <h3 className="text-sm font-bold text-gray-300 uppercase tracking-widest"><i className="fas fa-database mr-2"></i> Manajemen Data</h3>
             <div className="grid grid-cols-2 gap-4">
                 <button onClick={handleBackup} className="bg-gray-700 hover:bg-gray-600 text-white p-3 rounded-lg flex items-center justify-center gap-2 transition">
                     <i className="fas fa-download"></i> Backup Semua Data
                 </button>
                 <button onClick={() => fileInputRef.current?.click()} className="bg-gray-700 hover:bg-gray-600 text-white p-3 rounded-lg flex items-center justify-center gap-2 transition">
                     <i className="fas fa-upload"></i> Restore Data
                 </button>
                 <input type="file" ref={fileInputRef} onChange={handleRestore} accept=".json" className="hidden" />
             </div>
             {backupStatus && <p className="text-center text-sm text-green-400 mt-2 animate-pulse">{backupStatus}</p>}
          </div>

          <div className="h-px bg-gray-750 my-4"></div>

          {/* OpenClaw Bridge Integration */}
          <div className="space-y-3 bg-gray-900/50 p-4 rounded-xl border border-gray-700">
             <div className="flex justify-between items-center">
                 <h3 className="text-sm font-bold text-primary-400 uppercase tracking-widest">
                     <i className="fas fa-network-wired mr-2"></i> OpenClaw Bridge
                 </h3>
                 <label className="relative inline-flex items-center cursor-pointer">
                     <input 
                         type="checkbox" 
                         className="sr-only peer"
                         checked={localSettings.bridgeEnabled}
                         onChange={(e) => setLocalSettings({...localSettings, bridgeEnabled: e.target.checked})}
                     />
                     <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
                 </label>
             </div>
             
             {localSettings.bridgeEnabled && (
                 <div className="space-y-4 mt-4 animate-fade-in">
                     <div className="space-y-2">
                         <label className="block text-sm font-medium text-gray-300">Bridge Tunnel URL</label>
                         <p className="text-xs text-gray-500">URL publik dari Node.js Bridge Server Anda (contoh: https://[random].serveousercontent.com)</p>
                         <input
                             type="text"
                             value={localSettings.bridgeUrl}
                             onChange={(e) => setLocalSettings({...localSettings, bridgeUrl: e.target.value})}
                             className="w-full bg-gray-950 border border-gray-750 rounded-lg p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none font-mono text-sm"
                             placeholder="https://..."
                         />
                     </div>
                     <div className="space-y-2">
                         <label className="block text-sm font-medium text-gray-300">Session ID</label>
                         <p className="text-xs text-gray-500">ID unik untuk sesi ini. Digunakan untuk sinkronisasi dengan Termux.</p>
                         <div className="flex gap-2">
                             <input
                                 type="text"
                                 value={localSettings.bridgeSessionId}
                                 readOnly
                                 className="w-full bg-gray-950 border border-gray-750 rounded-lg p-3 text-gray-400 outline-none font-mono text-sm cursor-not-allowed"
                             />
                             <button 
                                 onClick={() => setLocalSettings({...localSettings, bridgeSessionId: `session-${Math.random().toString(36).substring(2, 15)}`})}
                                 className="px-4 bg-gray-700 hover:bg-gray-600 text-white rounded-lg border border-gray-600 transition"
                                 title="Generate New Session ID"
                             >
                                 <i className="fas fa-sync"></i>
                             </button>
                         </div>
                     </div>
                 </div>
             )}
          </div>

        </div>

        <div className="p-6 border-t border-gray-750 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg hover:bg-gray-750 text-white transition">Batal</button>
          <button onClick={handleSave} className="px-6 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg font-bold transition shadow-lg shadow-primary-500/20">
            Simpan Pengaturan
          </button>
        </div>

      </div>
    </div>
  );
};

export default SettingsModal;
