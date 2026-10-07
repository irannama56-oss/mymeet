import React, { useState, useEffect, useRef } from 'react';
import { X, Send, Smile, MessageSquare, Crown, Shield } from 'lucide-react';
import { ChatMessage } from '../lib/types';
import { sounds } from '../lib/sound';

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  currentUserId: string;
}

// Helper to format text with clickable links
function renderFormattedMessage(text: string) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, index) => {
    if (urlRegex.test(part)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-300 underline hover:text-indigo-200 transition-colors break-all"
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

export const ChatDrawer: React.FC<ChatDrawerProps> = ({
  isOpen,
  onClose,
  messages,
  onSendMessage,
  currentUserId,
}) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else {
      setInputText('');
    }
  }, [messages, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    sounds.playClick();
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <aside
      aria-label="In-meeting Chat"
      className="fixed top-0 right-0 h-full w-full sm:w-96 z-50 glass-panel border-l border-slate-700/60 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200 select-none"
    >
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-white text-sm truncate">In-Call Messages</h2>
            <p className="text-[11px] text-slate-400 truncate">Direct peer communication</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 transition-all cursor-pointer shrink-0"
          aria-label="Close Chat"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Messages list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-3">
              <MessageSquare className="w-7 h-7" />
            </div>
            <p className="text-sm font-semibold text-slate-300">No messages yet</p>
            <p className="text-xs text-slate-500 mt-1 max-w-[200px]">
              Type a message below to share thoughts or links with everyone.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.senderId === currentUserId;
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center space-x-1.5 mb-1 px-1">
                  <span className="text-[11px] font-medium text-slate-400">
                    {isMe ? 'You' : msg.senderName}
                  </span>
                  {msg.isHost ? (
                    <span title="Host">
                      <Crown className="w-3 h-3 text-amber-400" />
                    </span>
                  ) : null}
                  <span className="text-[10px] text-slate-500 font-mono">{formatTime(msg.timestamp)}</span>
                </div>
                <div
                  className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-xs leading-relaxed break-words shadow-md selectable-text ${
                    isMe
                      ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white rounded-tr-xs'
                      : 'bg-slate-800/90 text-slate-100 border border-slate-700/60 rounded-tl-xs'
                  }`}
                >
                  {renderFormattedMessage(msg.text)}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-slate-800/90 bg-dark-950/70">
        <div className="flex items-center space-x-2 bg-dark-900 border border-slate-700/80 rounded-2xl px-3.5 py-2.5 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent transition-all">
          <input
            type="text"
            placeholder="Send a message to everyone..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            className="flex-1 bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer shadow-md"
            aria-label="Send message"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>
    </aside>
  );
};
