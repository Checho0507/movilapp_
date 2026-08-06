import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  FlatList, ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/context/SocketContext';
import colors from '@/constants/colors';

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

interface ConvMessage {
  id: number;
  conversationId: number;
  senderId: number;
  senderName: string;
  senderRole: string;
  content: string;
  createdAt: string;
}

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
}

async function getAuthHeaders() {
  const token = await AsyncStorage.getItem('auth_token');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const convId = parseInt(id ?? '0');
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { socket } = useSocket();
  const flatRef = useRef<FlatList>(null);

  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ConvMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  // Load conversation details + messages
  const loadAll = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const [convRes, msgsRes] = await Promise.all([
        fetch(`${BASE_URL}/conversations`, { headers }),
        fetch(`${BASE_URL}/conversations/${convId}/messages`, { headers }),
      ]);
      if (convRes.ok) {
        const convs: Conversation[] = await convRes.json();
        const found = convs.find(c => c.id === convId);
        if (found) setConv(found);
      }
      if (msgsRes.ok) {
        setMessages(await msgsRes.json());
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [convId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 120);
    }
  }, [messages.length]);

  // Real-time socket listener
  useEffect(() => {
    if (!socket) return;
    const handler = (data: { conversationId: number; message: ConvMessage }) => {
      if (data.conversationId !== convId) return;
      setMessages(prev =>
        prev.find(m => m.id === data.message.id) ? prev : [...prev, data.message],
      );
    };
    socket.on('conv:message', handler);
    return () => { socket.off('conv:message', handler); };
  }, [socket, convId]);

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    const content = text.trim();
    setText('');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BASE_URL}/conversations/${convId}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        const msg: ConvMessage = await res.json();
        setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg]);
      }
    } catch { /* ignore */ }
    finally { setSending(false); }
  };

  // Derive title
  const title = conv
    ? conv.type === 'support'
      ? '🛡️ Administración'
      : conv.userId === user?.id
      ? conv.otherUserName
      : conv.userName
    : 'Chat';

  const subtitle = conv?.subject ?? '';

  function renderMessage({ item }: { item: ConvMessage }) {
    const mine = item.senderId === user?.id;
    const isAdmin = item.senderRole === 'admin';

    // For the current user: always right-aligned.
    // For admin messages: show with accent color if not mine
    return (
      <View style={[styles.msgRow, mine && styles.msgRowMine]}>
        <View style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleOther,
          isAdmin && !mine && styles.bubbleAdmin,
        ]}>
          {!mine && (
            <Text style={[styles.senderLabel, isAdmin && styles.senderLabelAdmin]}>
              {item.senderName}
            </Text>
          )}
          <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
            {item.content}
          </Text>
          <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>
            {new Date(item.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.bottom + 10}
    >
      <View style={[styles.root, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.light.foreground} />
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
            {subtitle ? <Text style={styles.headerSub} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
          {conv?.status === 'resolved' && (
            <View style={styles.resolvedBadge}>
              <Text style={styles.resolvedText}>Resuelto</Text>
            </View>
          )}
        </View>

        {/* Messages */}
        {loading ? (
          <ActivityIndicator style={{ flex: 1 }} color={colors.light.primary} />
        ) : (
          <FlatList
            ref={flatRef}
            data={messages}
            keyExtractor={item => String(item.id)}
            renderItem={renderMessage}
            contentContainerStyle={styles.msgList}
            onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Feather name="message-circle" size={40} color={colors.light.mutedForeground} />
                <Text style={styles.emptyText}>Sin mensajes aún{'\n'}Sé el primero en escribir</Text>
              </View>
            }
          />
        )}

        {/* Input */}
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 16 : 8) }]}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Escribe un mensaje..."
            placeholderTextColor={colors.light.mutedForeground}
            multiline
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!text.trim() || sending}
          >
            {sending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Feather name="send" size={18} color="#fff" />
            }
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.light.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.light.border,
    backgroundColor: colors.light.card,
  },
  backBtn: { padding: 4 },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold' },
  headerSub: { fontSize: 12, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 1 },
  resolvedBadge: {
    paddingHorizontal: 10, paddingVertical: 3,
    backgroundColor: '#10B981' + '20',
    borderRadius: 10, borderWidth: 1, borderColor: '#10B981' + '50',
  },
  resolvedText: { fontSize: 11, fontWeight: '600', color: '#10B981', fontFamily: 'Inter_600SemiBold' },
  msgList: { paddingHorizontal: 14, paddingVertical: 12, gap: 8, flexGrow: 1 },
  msgRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  msgRowMine: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '75%',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
    borderRadius: 18,
    gap: 4,
  },
  bubbleOther: {
    backgroundColor: colors.light.card,
    borderWidth: 1,
    borderColor: colors.light.border,
    borderTopLeftRadius: 4,
  },
  bubbleAdmin: {
    backgroundColor: '#1e1e2e',
    borderColor: colors.light.primary + '50',
  },
  bubbleMine: {
    backgroundColor: colors.light.primary,
    borderTopRightRadius: 4,
  },
  senderLabel: { fontSize: 10, fontWeight: '600', color: colors.light.mutedForeground, fontFamily: 'Inter_600SemiBold' },
  senderLabelAdmin: { color: colors.light.primary },
  bubbleText: { fontSize: 14, color: colors.light.foreground, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  bubbleTextMine: { color: '#fff' },
  bubbleTime: { fontSize: 10, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular', alignSelf: 'flex-end' },
  bubbleTimeMine: { color: 'rgba(255,255,255,0.6)' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 14, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 22 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.light.border,
    backgroundColor: colors.light.card,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: colors.light.background,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.light.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.light.foreground,
    fontFamily: 'Inter_400Regular',
  },
  sendBtn: {
    width: 44, height: 44,
    borderRadius: 22,
    backgroundColor: colors.light.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
});
