import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

interface SocketContextType {
  socket: Socket | null;
  connected: boolean;
  joinTrip: (tripId: number) => void;
  leaveTrip: (tripId: number) => void;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  connected: false,
  joinTrip: () => {},
  leaveTrip: () => {},
});

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuth();
  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token || !user) return;
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    const s = io(`https://${domain}`, {
      path: '/api/socket.io',
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
    });
    socketRef.current = s;
    setSocket(s);
    s.on('connect', () => {
      setConnected(true);
      // Join personal room so server can emit events to this user
      s.emit('join_user', user.id);
    });
    s.on('reconnect', () => {
      // Re-join on reconnect in case the server restarted
      s.emit('join_user', user.id);
    });
    s.on('disconnect', () => setConnected(false));
    return () => {
      s.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, [token, user?.id]);

  const joinTrip = (tripId: number) => socketRef.current?.emit('join:trip', tripId);
  const leaveTrip = (tripId: number) => socketRef.current?.emit('leave:trip', tripId);

  return (
    <SocketContext.Provider value={{ socket, connected, joinTrip, leaveTrip }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
