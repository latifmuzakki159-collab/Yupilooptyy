import React, { useState, useEffect } from 'react';
import { AppSettings, Character, Message } from '../types';

interface Props {
  settings: AppSettings;
  character: Character;
  onInjectDirection: (direction: string) => void;
  onInjectUserMessage: (message: string) => void;
  lastCharacterMessage: Message | null;
}

const CollaborativeBridge: React.FC<Props> = ({ settings, character, onInjectDirection, onInjectUserMessage, lastCharacterMessage }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [direction, setDirection] = useState('');
  const [status, setStatus] = useState<'idle' | 'polling' | 'received'>('idle');
  const [lastNotificationId, setLastNotificationId] = useState<string>('');

  // Auto-notification when character replies (Bridge Mode)
  useEffect(() => {
    if (!settings.bridgeEnabled || !settings.bridgeUrl || !lastCharacterMessage) return;
    
    if (lastCharacterMessage.id !== lastNotificationId && lastCharacterMessage.role === 'model') {
      setLastNotificationId(lastCharacterMessage.id);
      
      // Notify OpenClaw that character replied, including the actual text
      const notifyBridge = async () => {
        try {
          const cleanUrl = settings.bridgeUrl.replace(/\/$/, '');
          await fetch(`${cleanUrl}/collab-notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              session_id: settings.bridgeSessionId, 
              event: 'character_replied',
              character_name: character.name,
              timestamp: lastCharacterMessage.timestamp,
              reply_text: lastCharacterMessage.content // Send the actual text back!
            })
          });
        } catch (e) {
          // Ignore notification errors
        }
      };
      notifyBridge();
    }
  }, [lastCharacterMessage, settings, lastNotificationId, character.name]);

  // Polling for collaborative directions or remote user messages
  useEffect(() => {
    if (!settings.bridgeEnabled || !settings.bridgeUrl) return;
    
    const pollCollab = async () => {
      try {
        const cleanUrl = settings.bridgeUrl.replace(/\/$/, '');
        const res = await fetch(`${cleanUrl}/poll-collab?session_id=${settings.bridgeSessionId}`, {
          headers: {
            'Accept': 'application/json',
            'ngrok-skip-browser-warning': 'true',
            'Bypass-Tunnel-Reminder': 'true'
          }
        });
        
        if (res.ok) {
          const data = await res.json();
          
          let handled = false;
          
          // 1. Handle Hidden Direction (Sutradara)
          if (data.has_direction && data.direction) {
            setStatus('received');
            onInjectDirection(data.direction);
            handled = true;
          } 
          // 2. Handle Visible User Message (OpenClaw as User)
          else if (data.has_user_message && data.user_message) {
            setStatus('received');
            onInjectUserMessage(data.user_message);
            handled = true;
          }

          if (handled) {
            // Acknowledge receipt
            await fetch(`${cleanUrl}/ack-collab`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session_id: settings.bridgeSessionId, status: 'received' })
            });
            
            setTimeout(() => setStatus('idle'), 3000);
          }
        }
      } catch (e) {
        // Ignore polling errors to avoid console spam
      }
    };

    const intervalId = setInterval(pollCollab, 3000);
    return () => clearInterval(intervalId);
  }, [settings.bridgeEnabled, settings.bridgeUrl, settings.bridgeSessionId, onInjectDirection, onInjectUserMessage]);

  const handleManualSubmit = () => {
    if (!direction.trim()) return;
    onInjectDirection(direction);
    setDirection('');
    setIsOpen(false);
  };

  return (
    <div className="absolute top-20 right-6 z-40">
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all ${status === 'received' ? 'bg-green-500 animate-pulse' : 'bg-purple-600 hover:bg-purple-500'} text-white`}
        title="Mode Kolaboratif / Remote User"
      >
        <i className="fas fa-robot text-xl"></i>
      </button>

      {isOpen && (
        <div className="absolute top-14 right-0 w-80 bg-gray-900 border border-purple-500/50 rounded-xl shadow-2xl overflow-hidden animate-fade-in">
          <div className="bg-purple-900/30 px-4 py-3 border-b border-purple-500/30 flex justify-between items-center">
            <h3 className="text-sm font-bold text-purple-400"><i className="fas fa-robot mr-2"></i> Bridge Monitor</h3>
            <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white"><i className="fas fa-times"></i></button>
          </div>
          <div className="p-4">
            <p className="text-xs text-gray-400 mb-3">
              Kirim arahan tersembunyi secara manual, atau biarkan OpenClaw mengontrol input User secara otomatis.
            </p>
            <textarea 
              value={direction}
              onChange={e => setDirection(e.target.value)}
              className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 text-sm text-white h-24 focus:ring-2 focus:ring-purple-500 outline-none resize-none mb-3"
              placeholder="Ketik arahan tersembunyi..."
            />
            <button 
              onClick={handleManualSubmit}
              disabled={!direction.trim()}
              className="w-full bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 text-white py-2 rounded-lg text-sm font-bold transition"
            >
              Kirim Arahan Manual
            </button>
            
            {settings.bridgeEnabled && (
              <div className="mt-4 pt-3 border-t border-gray-800 flex items-center justify-between text-xs">
                <span className="text-gray-500">Bridge Status:</span>
                <span className="text-green-400 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> Listening to OpenClaw</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CollaborativeBridge;
