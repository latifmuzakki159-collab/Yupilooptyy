import React, { useState, useEffect, useRef } from 'react';
import { AppSettings } from '../types';
import { makeLLMRequest } from '../services/geminiService';

interface Props {
  settings: AppSettings;
}

type BridgeStatus = 'disconnected' | 'connected' | 'processing' | 'error';

const BridgeManager: React.FC<Props> = ({ settings }) => {
  const [status, setStatus] = useState<BridgeStatus>('disconnected');
  const [lastMessage, setLastMessage] = useState<string>('');
  const [isVisible, setIsVisible] = useState<boolean>(true);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    if (!settings.bridgeEnabled || !settings.bridgeUrl) {
      setStatus('disconnected');
      return;
    }

    // Register session on startup
    const registerSession = async () => {
      try {
        const cleanUrl = settings.bridgeUrl.replace(/\/$/, '');
        await fetch(`${cleanUrl}/register?session=${settings.bridgeSessionId}`, {
          method: 'POST'
        });
      } catch (e) {
        console.warn('Bridge registration failed, will retry on poll', e);
      }
    };
    registerSession();

    const pollBridge = async () => {
      if (isProcessingRef.current) return; // Skip polling if currently processing a request

      try {
        const cleanUrl = settings.bridgeUrl.replace(/\/$/, '');
        const response = await fetch(`${cleanUrl}/poll?session_id=${settings.bridgeSessionId}`, {
          headers: {
            'Accept': 'application/json',
            'ngrok-skip-browser-warning': 'true', // Bypass ngrok warning page
            'Bypass-Tunnel-Reminder': 'true'      // Bypass localtunnel warning page
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          const text = await response.text();
          throw new Error(`Expected JSON but got HTML/Text. Tunnel might be showing a warning page or URL is incorrect. Preview: ${text.substring(0, 50)}`);
        }
        
        const data = await response.json();
        
        if (status === 'disconnected' || status === 'error') {
          setStatus('connected');
        }

        if (data.has_pending_request && data.request) {
          await handleAwarenessTransfer(data.request);
        }
      } catch (error) {
        console.error('Bridge polling failed:', error);
        setStatus('error');
      }
    };

    const intervalId = setInterval(pollBridge, 2000);
    return () => clearInterval(intervalId);
  }, [settings.bridgeEnabled, settings.bridgeUrl, settings.bridgeSessionId]);

  const handleAwarenessTransfer = async (request: any) => {
    isProcessingRef.current = true;
    setStatus('processing');
    setLastMessage(`Menerima request dari Termux: ${request.action || 'task'}`);

    try {
      // 1. Parse context dari Termux
      const contextStr = JSON.stringify(request.context || {}, null, 2);
      const payloadStr = JSON.stringify(request.payload || {}, null, 2);
      
      const prompt = `[SYSTEM: AWARENESS TRANSFER FROM OPENCLAW/TERMUX]
Tugas Anda adalah memproses request dari environment lokal/Termux user.

Action: ${request.action || 'continue_conversation'}
Context:
${contextStr}

Payload/Data:
${payloadStr}

Berikan respon yang sesuai untuk dikembalikan ke Termux.`;

      // 2. Generate response menggunakan model AI
      const aiResponseText = await makeLLMRequest(
        settings, 
        [{ role: 'user', content: prompt }],
        "You are the central intelligence of OpenClaw. Process the awareness transfer from the local terminal and provide a helpful, accurate response."
      );

      // 3. Format response
      const responsePayload = {
        type: "awareness_response",
        session_id: settings.bridgeSessionId,
        status: "success",
        message: "Processed successfully by GeminRP",
        data: {
          reply_text: aiResponseText,
          action_suggestions: [],
          files_to_create: [],
          next_steps: "Awaiting next command."
        }
      };

      // 4. Kirim balik ke bridge
      const cleanUrl = settings.bridgeUrl.replace(/\/$/, '');
      await fetch(`${cleanUrl}/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(responsePayload)
      });

      setLastMessage('Respon berhasil dikirim ke Termux');
      setTimeout(() => setLastMessage(''), 3000);
    } catch (error: any) {
      console.error('Error processing awareness transfer:', error);
      
      // Send error back to bridge
      try {
        const cleanUrl = settings.bridgeUrl.replace(/\/$/, '');
        await fetch(`${cleanUrl}/response`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: "awareness_response",
            session_id: settings.bridgeSessionId,
            status: "error",
            message: error.message || "Internal processing error",
            data: null
          })
        });
      } catch (e) {
        console.error('Failed to send error response to bridge', e);
      }
    } finally {
      setStatus('connected');
      isProcessingRef.current = false;
    }
  };

  if (!settings.bridgeEnabled) return null;

  return (
    <div className={`fixed bottom-4 right-4 z-50 transition-transform duration-300 ${isVisible ? 'translate-y-0' : 'translate-y-[calc(100%-40px)]'}`}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl shadow-black/50 overflow-hidden w-80">
        {/* Header / Toggle */}
        <div 
          className="bg-gray-800 px-4 py-2 flex justify-between items-center cursor-pointer border-b border-gray-700"
          onClick={() => setIsVisible(!isVisible)}
        >
          <div className="flex items-center gap-2">
            <i className="fas fa-network-wired text-primary-400"></i>
            <span className="font-bold text-sm text-white">OpenClaw Bridge</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              status === 'connected' ? 'bg-green-500 animate-pulse' : 
              status === 'processing' ? 'bg-yellow-500 animate-ping' : 
              status === 'error' ? 'bg-red-500' : 'bg-gray-500'
            }`}></div>
            <i className={`fas fa-chevron-${isVisible ? 'down' : 'up'} text-gray-400 text-xs`}></i>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          <div className="flex justify-between items-center text-xs">
            <span className="text-gray-400">Status:</span>
            <span className={`font-mono font-bold ${
              status === 'connected' ? 'text-green-400' : 
              status === 'processing' ? 'text-yellow-400' : 
              status === 'error' ? 'text-red-400' : 'text-gray-400'
            }`}>
              {status.toUpperCase()}
            </span>
          </div>
          
          <div className="flex justify-between items-center text-xs">
            <span className="text-gray-400">Session ID:</span>
            <span className="font-mono text-primary-300 truncate max-w-[150px]" title={settings.bridgeSessionId}>
              {settings.bridgeSessionId}
            </span>
          </div>

          {lastMessage && (
            <div className="mt-2 p-2 bg-gray-950 rounded border border-gray-800 text-xs text-gray-300 font-mono break-words">
              {lastMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BridgeManager;
