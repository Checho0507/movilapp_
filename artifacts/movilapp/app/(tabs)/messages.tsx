import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/context/SocketContext';
import colors from '@/constants/colors';

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

interface Conversation {
  id: number;
  type: 'support' | 'direct';
  userId: number;
  otherUserId: number | null;
  subject: string;
  status: 'open' | 'resolved';
  createdAt: string;
  updatedAt: string;
  userName: string;
  userRole: string;
  otherUserName: string;
  otherUserRole: string;
  lastMessage: { content: string; createdAt: string } | null;
}

async function fetchConversations(token: string): Promise<Conversation[]> {
  const res = await fetch(`${BASE_URL}/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Error al cargar conversaciones');
  return res.json();
}

async function createSupportConversation(token: string): Promise<Conversation> {
  const res = await fetch(`${BASE_URL}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: 'support', subject: 'Consulta de soporte' }),
  });
  if (!res.ok) throw new Error('Error al crear conversación');
  return res.json();
}

function ConvCard({ conv, myId }: { conv: Conversation; myId: number }) {
  const isSupport = conv.type === 'support';
  const otherName = isSupport
    ? 'Soporte Admin'
    : conv.userId === myId
    ? conv.otherUserName
    : conv.userName;

  const preview = conv.lastMessage?.content ?? 'Sin mensajes aún';
  const time = conv.lastMessage
    ? new Date(conv.lastMessage.createdAt).toLocaleTimeString('es-CO', {
        hour: '2-digit', minute: '2-digit',
      })
    : '';

  return (
    <TouchableOpacity
      style={styles.convCard}
      activeOpacity={0.8}
      onPress={() => router.push(`/chat/${conv.id}`)}
    >
      <View style={[styles.convAvatar, isSupport && styles.convAvatarSupport]}>
        <Feather
          name={isSupport ? 'shield' : 'user'}
          size={20}
          color={isSupport ? '#fff' : colors.light.primary}
        />
      </View>
      <View style={styles.convBody}>
        <View style={styles.convRow}>
          <Text style={styles.convName} numberOfLines={1}>{otherName}</Text>
          <Text style={styles.convTime}>{time}</Text>
        </View>
        <View style={styles.convRow}>
          <Text style={styles.convPreview} numberOfLines={1}>{preview}</Text>
          {conv.status === 'resolved' && (
            <View style={styles.resolvedBadge}>
              <Text style={styles.resolvedText}>Resuelto</Text>
            </View>
          )}
        </View>
        {!isSupport && (
          <Text style={styles.convSubject} numberOfLines={1}>{conv.subject}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { socket } = useSocket();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('auth_token');
      if (!token) return;
      const data = await fetchConversations(token);
      setConversations(data);
    } catch (e) {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load();
  }, [load]));

  // Real-time: when a new message arrives, bump the conversation to top
  useEffect(() => {
    if (!socket) return;

    const onMessage = (data: { conversationId: number; message: any }) => {
      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === data.conversationId);
        if (idx < 0) {
          // Unknown conversation — reload
          load();
          return prev;
        }
        const updated = {
          ...prev[idx],
          lastMessage: { content: data.message.content, createdAt: data.message.createdAt },
          updatedAt: data.message.createdAt,
        };
        const rest = prev.filter((_, i) => i !== idx);
        return [updated, ...rest];
      });
    };

    const onNew = (conv: Conversation) => {
      setConversations(prev =>
        prev.find(c => c.id === conv.id) ? prev : [conv, ...prev],
      );
    };

    socket.on('conv:message', onMessage);
    socket.on('conv:new', onNew);
    return () => {
      socket.off('conv:message', onMessage);
      socket.off('conv:new', onNew);
    };
  }, [socket, load]);

  const handleNewSupport = async () => {
    setCreating(true);
    try {
      const token = await AsyncStorage.getItem('auth_token');
      if (!token) return;
      const conv = await createSupportConversation(token);
      // Navigate directly to it
      router.push(`/chat/${conv.id}`);
      await load();
    } catch {
      Alert.alert('Error', 'No se pudo iniciar la conversación.');
    } finally {
      setCreating(false);
    }
  };

  const hasSupport = conversations.some(c => c.type === 'support');

  return (
    <View style={[styles.root, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Mensajes</Text>
      </View>

      {/* Support CTA for drivers — always visible if no open support conv */}
      {user?.role === 'driver' && !hasSupport && (
        <TouchableOpacity
          style={styles.supportCTA}
          onPress={handleNewSupport}
          disabled={creating}
          activeOpacity={0.85}
        >
          <Feather name="shield" size={20} color="#fff" />
          <View style={{ flex: 1 }}>
            <Text style={styles.supportCTATitle}>Contactar Administración</Text>
            <Text style={styles.supportCTASub}>Para casos especiales o incidencias</Text>
          </View>
          {creating
            ? <ActivityIndicator color="#fff" size="small" />
            : <Feather name="chevron-right" size={18} color="rgba(255,255,255,0.8)" />
          }
        </TouchableOpacity>
      )}

      {/* Passenger support CTA */}
      {user?.role === 'passenger' && !hasSupport && (
        <TouchableOpacity
          style={[styles.supportCTA, { backgroundColor: colors.light.primary }]}
          onPress={handleNewSupport}
          disabled={creating}
          activeOpacity={0.85}
        >
          <Feather name="help-circle" size={20} color="#fff" />
          <View style={{ flex: 1 }}>
            <Text style={styles.supportCTATitle}>Ayuda y soporte</Text>
            <Text style={styles.supportCTASub}>Comunícate con nuestro equipo</Text>
          </View>
          {creating
            ? <ActivityIndicator color="#fff" size="small" />
            : <Feather name="chevron-right" size={18} color="rgba(255,255,255,0.8)" />
          }
        </TouchableOpacity>
      )}

      {/* Conversation list */}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.light.primary} />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={item => String(item.id)}
          renderItem={({ item }) => <ConvCard conv={item} myId={user?.id ?? 0} />}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="message-square" size={44} color={colors.light.mutedForeground} />
              <Text style={styles.emptyTitle}>Sin mensajes</Text>
              <Text style={styles.emptySub}>
                {user?.role === 'driver'
                  ? 'Usa el botón de arriba para contactar a la administración'
                  : 'Tus conversaciones aparecerán aquí'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.light.background },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.light.border,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.light.foreground,
    fontFamily: 'Inter_700Bold',
  },
  supportCTA: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    margin: 16,
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#DC2626',
  },
  supportCTATitle: { fontSize: 15, fontWeight: '700', color: '#fff', fontFamily: 'Inter_700Bold' },
  supportCTASub: { fontSize: 12, color: 'rgba(255,255,255,0.8)', fontFamily: 'Inter_400Regular', marginTop: 2 },
  list: { paddingBottom: 120 },
  convCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  convAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.light.primary + '20',
    borderWidth: 1,
    borderColor: colors.light.primary + '40',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  convAvatarSupport: {
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },
  convBody: { flex: 1, gap: 3 },
  convRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  convName: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold' },
  convTime: { fontSize: 11, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular', flexShrink: 0 },
  convPreview: { flex: 1, fontSize: 13, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular' },
  convSubject: { fontSize: 11, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular', fontStyle: 'italic' },
  resolvedBadge: {
    paddingHorizontal: 8, paddingVertical: 2,
    backgroundColor: '#10B981' + '25',
    borderRadius: 8, borderWidth: 1, borderColor: '#10B981' + '60',
  },
  resolvedText: { fontSize: 10, fontWeight: '600', color: '#10B981', fontFamily: 'Inter_600SemiBold' },
  separator: { height: 1, backgroundColor: colors.light.border, marginHorizontal: 20 },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold' },
  emptySub: { fontSize: 14, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 22 },
});
