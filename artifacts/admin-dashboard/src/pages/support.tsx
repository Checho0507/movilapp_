import { useEffect, useRef, useState, useCallback } from 'react';
import { Sidebar } from '@/components/sidebar';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { io, Socket } from 'socket.io-client';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { MessageSquare, Send, CheckCircle, Circle, Paperclip, X } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Conversation {
  id: number;
  type: 'support' | 'direct';
  userId: number;
  otherUserId: number | null;
  subject: string;
  status: 'open' | 'resolved';
  userName: string;
  userRole: string;
  otherUserName: string;
  updatedAt: string;
  lastMessage: { content: string; createdAt: string } | null;
}

interface ConvMessage {
  id: number;
  conversationId: number;
  senderId: number;
  senderName: string;
  senderRole: string;
  content: string;
  createdAt: string;
  attachments?: { name: string; mimeType: string; size: number; url: string }[];
}

function AuthenticatedAttachment({ file }: { file: NonNullable<ConvMessage['attachments']>[number] }) {
  const [src, setSrc] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    let objectUrl: string | undefined;
    fetch(`/api${file.url}`, { headers: { Authorization: `Bearer ${token()}` } })
      .then(res => {
        if (!res.ok) throw new Error(`Attachment request failed: ${res.status}`);
        return res.blob();
      })
      .then(blob => {
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(error => console.error('Unable to load attachment', error));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.url]);

  if (file.mimeType.startsWith('image/')) {
    return src
      ? <>
          <button
            type="button"
            className="block mt-2 cursor-zoom-in"
            onClick={() => setIsOpen(true)}
            aria-label={`Abrir imagen ${file.name}`}
          >
            <img src={src} alt={file.name} className="max-w-full max-h-56 rounded-lg" />
          </button>
          {isOpen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
              role="dialog"
              aria-modal="true"
              aria-label={file.name}
              onClick={() => setIsOpen(false)}
              onKeyDown={event => {
                if (event.key === 'Escape') setIsOpen(false);
              }}
              tabIndex={-1}
            >
              <button
                type="button"
                className="absolute right-5 top-5 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
                aria-label="Cerrar imagen"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
              <img
                src={src}
                alt={file.name}
                className="max-h-[90vh] max-w-[90vw] object-contain"
                onClick={event => event.stopPropagation()}
              />
            </div>
          )}
        </>
      : <span className="block text-xs text-muted-foreground mt-2">Cargando {file.name}...</span>;
  }

  return (
    <a
      href={`/api${file.url}`}
      target="_blank"
      rel="noreferrer"
      className="block text-sm underline mt-2"
      onClick={async event => {
        event.preventDefault();
        const res = await fetch(`/api${file.url}`, { headers: { Authorization: `Bearer ${token()}` } });
        if (!res.ok) return;
        const blobUrl = URL.createObjectURL(await res.blob());
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = file.name;
        link.click();
        URL.revokeObjectURL(blobUrl);
      }}
    >
      {file.name}
    </a>
  );
}

// ─── API helpers ──────────────────────────────────────────────────────────────
function token() { return localStorage.getItem('token') ?? ''; }

async function apiFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(opts.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── ConversationItem ─────────────────────────────────────────────────────────
function ConversationItem({
  conv, active, unread, onClick,
}: {
  conv: Conversation;
  active: boolean;
  unread: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 flex items-start gap-3 border-b border-border transition-colors ${
        active ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-muted/40'
      }`}
    >
      <div className="shrink-0 w-9 h-9 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-xs font-bold text-primary font-mono">
        {conv.userName.slice(0, 2).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-semibold truncate ${active ? 'text-primary' : 'text-foreground'}`}>
            {conv.userName}
          </span>
          <span className="text-xs text-muted-foreground font-mono shrink-0">
            {conv.updatedAt ? format(new Date(conv.updatedAt), 'HH:mm') : ''}
          </span>
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{conv.subject}</p>
        <p className="text-xs text-muted-foreground/70 truncate mt-0.5 italic">
          {conv.lastMessage?.content ?? 'Sin mensajes'}
        </p>
      </div>
      <div className="shrink-0 flex flex-col items-center gap-1">
        {conv.status === 'resolved'
          ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
          : <Circle className="w-3.5 h-3.5 text-amber-400" />
        }
        {unread && <span className="w-2 h-2 rounded-full bg-primary" />}
      </div>
    </button>
  );
}

// ─── ChatPanel ────────────────────────────────────────────────────────────────
function ChatPanel({
  conv, myId, onStatusChange,
}: {
  conv: Conversation;
  myId: number;
  onStatusChange: (convId: number, status: 'open' | 'resolved') => void;
}) {
  const [messages, setMessages] = useState<ConvMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<{ name: string; mimeType: string; size: number; data: string }[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    setLoadingMsgs(true);
    try {
      const data = await apiFetch(`/conversations/${conv.id}/messages`);
      setMessages(data);
    } catch { /* ignore */ }
    finally { setLoadingMsgs(false); }
  }, [conv.id]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if ((!text.trim() && !attachments.length) || sending) return;
    setSending(true);
    try {
      const msg = await apiFetch(`/conversations/${conv.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: text.trim(), attachments }),
      });
      setMessages(prev => [...prev, msg]);
      setText('');
      setAttachments([]);
      setAttachmentError(null);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'No se pudo enviar el mensaje');
    }
    finally { setSending(false); }
  };

  const toggleStatus = async () => {
    setTogglingStatus(true);
    const next = conv.status === 'open' ? 'resolved' : 'open';
    try {
      await apiFetch(`/conversations/${conv.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      onStatusChange(conv.id, next);
    } catch { /* ignore */ }
    finally { setTogglingStatus(false); }
  };

  // Real-time: accept new messages pushed via parent's socket
  useEffect(() => {
    // Parent forwards conv:message events via window custom event
    const handler = (e: Event) => {
      const { conversationId, message } = (e as CustomEvent).detail;
      if (conversationId === conv.id) {
        setMessages(prev =>
          prev.find(m => m.id === message.id) ? prev : [...prev, message],
        );
      }
    };
    window.addEventListener('conv:message', handler);
    return () => window.removeEventListener('conv:message', handler);
  }, [conv.id]);

  return (
    <div className="flex flex-col h-full">
      {/* Chat header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-foreground">{conv.userName}</h2>
          <p className="text-xs text-muted-foreground font-mono">
            {conv.userRole} · {conv.subject}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-xs font-mono font-semibold ${
            conv.status === 'open'
              ? 'bg-amber-400/15 text-amber-400 border border-amber-400/30'
              : 'bg-emerald-500/15 text-emerald-400 border border-emerald-400/30'
          }`}>
            {conv.status === 'open' ? 'Abierto' : 'Resuelto'}
          </span>
          <button
            onClick={toggleStatus}
            disabled={togglingStatus}
            className="text-xs px-3 py-1.5 rounded-md border border-border hover:border-primary/50 text-muted-foreground hover:text-foreground transition-colors font-mono"
          >
            {togglingStatus ? '...' : conv.status === 'open' ? 'Marcar resuelto' : 'Reabrir'}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {loadingMsgs ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <MessageSquare className="w-10 h-10 opacity-30" />
            <p className="text-sm">Sin mensajes aún</p>
          </div>
        ) : (
          messages.map(msg => {
            const isAdmin = msg.senderRole === 'admin';
            return (
              <div key={msg.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[72%] rounded-2xl px-4 py-2.5 ${
                  isAdmin
                    ? 'bg-primary text-primary-foreground rounded-tr-sm'
                    : 'bg-card border border-border text-foreground rounded-tl-sm'
                }`}>
                  {!isAdmin && (
                    <p className="text-xs font-semibold mb-1 text-muted-foreground">{msg.senderName}</p>
                  )}
                  {msg.content && <p className="text-sm leading-relaxed">{msg.content}</p>}
                  {msg.attachments?.map(file => <AuthenticatedAttachment key={file.url} file={file} />)}
                  <p className={`text-xs mt-1 ${isAdmin ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                    {format(new Date(msg.createdAt), 'HH:mm', { locale: es })}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-border space-y-2">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map(file => (
              <span key={`${file.name}-${file.size}`} className="text-xs rounded-md bg-muted px-2 py-1 text-foreground">
                {file.name}
              </span>
            ))}
          </div>
        )}
        {attachmentError && <p className="text-xs text-destructive">{attachmentError}</p>}
        <div className="flex items-end gap-3">
        <label className="shrink-0 w-10 h-10 rounded-xl border border-border flex items-center justify-center cursor-pointer hover:border-primary/60">
          <Paperclip className="w-4 h-4" />
          <input type="file" multiple className="hidden" accept="image/*,.pdf,.txt,.doc,.docx,.xls,.xlsx,.zip"
            onChange={async e => {
              setAttachmentError(null);
              try {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 5) throw new Error('Puedes adjuntar máximo 5 archivos');
                const next = await Promise.all(files.map(file => new Promise<typeof attachments[number]>((resolve, reject) => {
                  if (file.size > 8 * 1024 * 1024) return reject(new Error(`${file.name} supera el límite de 8 MB`));
                  const reader = new FileReader();
                  reader.onload = () => resolve({ name: file.name, mimeType: file.type, size: file.size, data: String(reader.result) });
                  reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}`));
                  reader.readAsDataURL(file);
                })));
                if (next.reduce((total, file) => total + file.size, 0) > 10 * 1024 * 1024) {
                  throw new Error('Los archivos superan el límite total de 10 MB');
                }
                setAttachments(next);
              } catch (error) {
                setAttachments([]);
                setAttachmentError(error instanceof Error ? error.message : 'No se pudo cargar el archivo');
              } finally {
                e.target.value = '';
              }
            }} />
        </label>
        <textarea
          className="flex-1 min-h-[44px] max-h-32 resize-none bg-muted/40 border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors font-mono"
          placeholder="Escribe un mensaje..."
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          rows={1}
        />
        <button
          onClick={sendMessage}
          disabled={(!text.trim() && !attachments.length) || sending}
          className="shrink-0 w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 transition-opacity hover:opacity-90"
        >
          <Send className="w-4 h-4" />
        </button>
        </div>
      </div>
    </div>
  );
}

// ─── SupportPage ──────────────────────────────────────────────────────────────
export default function SupportPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [unreadIds, setUnreadIds] = useState<Set<number>>(new Set());
  const [myId, setMyId] = useState<number>(0);
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('open');
  const socketRef = useRef<Socket | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      const data = await apiFetch('/conversations');
      setConversations(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  // Load my user id
  useEffect(() => {
    apiFetch('/auth/me').then((u: any) => setMyId(u.id)).catch(() => {});
    loadConversations();
  }, [loadConversations]);

  // Socket connection
  useEffect(() => {
    const t = token();
    if (!t) return;

    const socket = io(window.location.origin, {
      path: '/api/socket.io',
      auth: { token: t },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('conv:new', (conv: Conversation) => {
      setConversations(prev =>
        prev.find(c => c.id === conv.id) ? prev : [conv, ...prev],
      );
    });

    socket.on('conv:message', (data: { conversationId: number; message: ConvMessage }) => {
      // Update lastMessage in list
      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === data.conversationId);
        if (idx < 0) return prev;
        const updated = {
          ...prev[idx],
          lastMessage: { content: data.message.content, createdAt: data.message.createdAt },
          updatedAt: data.message.createdAt,
        };
        const rest = prev.filter((_, i) => i !== idx);
        return [updated, ...rest];
      });

      // Mark as unread if not active
      if (activeId !== data.conversationId) {
        setUnreadIds(prev => new Set([...prev, data.conversationId]));
      }

      // Forward to ChatPanel via custom event
      window.dispatchEvent(new CustomEvent('conv:message', { detail: data }));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [activeId]);

  const handleSelect = (id: number) => {
    setActiveId(id);
    setUnreadIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  };

  const handleStatusChange = (convId: number, status: 'open' | 'resolved') => {
    setConversations(prev =>
      prev.map(c => c.id === convId ? { ...c, status } : c),
    );
  };

  const activeConv = conversations.find(c => c.id === activeId) ?? null;
  const filtered = conversations.filter(c =>
    filter === 'all' ? true : c.status === filter,
  );

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />

      <main className="flex-1 flex overflow-hidden">
        {/* ── Conversations list ── */}
        <div className="w-80 shrink-0 border-r border-border flex flex-col">
          <div className="px-4 py-5 border-b border-border">
            <h1 className="text-xl font-bold text-foreground mb-3">Soporte</h1>
            {/* Filter tabs */}
            <div className="flex gap-1 bg-muted/40 rounded-lg p-1">
              {(['all', 'open', 'resolved'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`flex-1 text-xs py-1.5 rounded-md font-mono font-medium transition-colors ${
                    filter === f ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {f === 'all' ? 'Todos' : f === 'open' ? 'Abiertos' : 'Resueltos'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
                <MessageSquare className="w-8 h-8 opacity-30" />
                <p className="text-sm">Sin conversaciones</p>
              </div>
            ) : (
              filtered.map(conv => (
                <ConversationItem
                  key={conv.id}
                  conv={conv}
                  active={activeId === conv.id}
                  unread={unreadIds.has(conv.id)}
                  onClick={() => handleSelect(conv.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Chat panel ── */}
        <div className="flex-1 flex flex-col">
          {activeConv ? (
            <ChatPanel
              conv={activeConv}
              myId={myId}
              onStatusChange={handleStatusChange}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
              <MessageSquare className="w-16 h-16 opacity-20" />
              <p className="text-base font-medium">Selecciona una conversación</p>
              <p className="text-sm opacity-60">Las conversaciones de soporte aparecen aquí en tiempo real</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
