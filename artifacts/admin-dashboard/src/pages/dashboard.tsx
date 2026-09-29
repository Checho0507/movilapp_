import { useEffect, useRef, useState } from 'react';
import { useGetAdminStats, useListAdminTrips } from '@workspace/api-client-react';
import { Sidebar } from '@/components/sidebar';
import { TripStatusBadge } from '@/components/trip-status-badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Car, Navigation, DollarSign, Activity, Clock, AlertTriangle, X, MapPin } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { io, Socket } from 'socket.io-client';

// ─── Types ────────────────────────────────────────────────────────────────────
interface PanicAlert {
  id: string;
  driverId: number;
  driverName: string;
  lat: number | null;
  lng: number | null;
  message?: string;
  timestamp: string;
  notifiedDrivers: number;
}

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sublabel?: string;
  testId: string;
}

// ─── StatCard ─────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sublabel, testId }: StatCardProps) {
  return (
    <Card className="p-6 bg-card border-card-border hover:border-primary/50 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
          <p className="text-3xl font-bold font-mono text-foreground" data-testid={testId}>{value}</p>
          {sublabel && <p className="text-xs text-muted-foreground mt-1 font-mono">{sublabel}</p>}
        </div>
        <div className="p-3 bg-primary/10 rounded-lg">
          <Icon className="w-6 h-6 text-primary" />
        </div>
      </div>
    </Card>
  );
}

// ─── PanicAlertCard ───────────────────────────────────────────────────────────
function PanicAlertCard({ alert, onDismiss }: { alert: PanicAlert; onDismiss: (id: string) => void }) {
  const mapsUrl = alert.lat && alert.lng
    ? `https://www.google.com/maps?q=${alert.lat},${alert.lng}`
    : null;

  return (
    <div className="flex items-start gap-4 p-4 bg-destructive/10 border border-destructive/40 rounded-lg animate-pulse-once">
      {/* Icon */}
      <div className="shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-destructive/20 border border-destructive/50">
        <AlertTriangle className="w-5 h-5 text-destructive" />
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-bold text-destructive uppercase tracking-wide font-mono">
            🚨 PÁNICO — {alert.driverName}
          </span>
          <span className="text-xs text-muted-foreground font-mono ml-auto shrink-0">
            {format(new Date(alert.timestamp), 'HH:mm:ss', { locale: es })}
          </span>
        </div>

        {alert.message && (
          <p className="text-sm text-foreground mb-2 italic">"{alert.message}"</p>
        )}

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground font-mono">
          {alert.lat && alert.lng ? (
            mapsUrl ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-primary hover:underline"
              >
                <MapPin className="w-3 h-3" />
                {alert.lat.toFixed(5)}, {alert.lng.toFixed(5)} — Ver en mapa ↗
              </a>
            ) : (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {alert.lat.toFixed(5)}, {alert.lng.toFixed(5)}
              </span>
            )
          ) : (
            <span className="text-muted-foreground">Ubicación no disponible</span>
          )}
          <span>· {alert.notifiedDrivers} conductor(es) notificado(s)</span>
        </div>
      </div>

      {/* Dismiss */}
      <button
        onClick={() => onDismiss(alert.id)}
        className="shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors"
        title="Descartar alerta"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useGetAdminStats();
  const { data: recentTrips, isLoading: tripsLoading } = useListAdminTrips({ limit: 5 });

  const [panicAlerts, setPanicAlerts] = useState<PanicAlert[]>([]);
  const socketRef = useRef<Socket | null>(null);

  // Connect to Socket.io and listen for panic alerts
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const base = window.location.origin;
    const socket = io(base, {
      path: '/api/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Dashboard] Socket connected:', socket.id);
    });

    socket.on('admin:panic_alert', (data: Omit<PanicAlert, 'id'>) => {
      const alert: PanicAlert = { ...data, id: `${data.driverId}-${data.timestamp}` };
      // Play a beep via AudioContext
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
        osc.start();
        osc.stop(ctx.currentTime + 0.8);
      } catch { /* ignore — AudioContext may be blocked */ }

      setPanicAlerts(prev => [alert, ...prev].slice(0, 20));
    });

    socket.on('connect_error', (err) => {
      console.warn('[Dashboard] Socket error:', err.message);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const dismissAlert = (id: string) => {
    setPanicAlerts(prev => prev.filter(a => a.id !== id));
  };

  const dismissAll = () => setPanicAlerts([]);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />

      <main className="flex-1 p-8 overflow-auto">
        <div className="max-w-7xl mx-auto space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Vista general de la plataforma MovilApp</p>
          </div>

          {/* ── Panic Alerts Panel ── */}
          {panicAlerts.length > 0 && (
            <div className="rounded-xl border-2 border-destructive/60 bg-destructive/5 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-destructive" />
                    </span>
                    <span className="text-base font-bold text-destructive uppercase tracking-wider font-mono">
                      Alertas de Pánico ({panicAlerts.length})
                    </span>
                  </div>
                </div>
                <button
                  onClick={dismissAll}
                  className="text-xs text-muted-foreground hover:text-foreground font-mono underline underline-offset-2 transition-colors"
                >
                  Descartar todas
                </button>
              </div>

              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {panicAlerts.map(alert => (
                  <PanicAlertCard key={alert.id} alert={alert} onDismiss={dismissAlert} />
                ))}
              </div>
            </div>
          )}

          {/* ── Stats Grid ── */}
          {statsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="p-6"><Skeleton className="h-20" /></Card>
              ))}
            </div>
          ) : stats ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <StatCard icon={Users} label="Total Usuarios" value={stats.totalUsers.toLocaleString()} sublabel={`${stats.totalPassengers} pasajeros · ${stats.totalDrivers} conductores`} testId="stat-total-users" />
              <StatCard icon={Car} label="Conductores en línea" value={stats.onlineDrivers.toLocaleString()} sublabel={`${((stats.onlineDrivers / stats.totalDrivers) * 100).toFixed(1)}% activos`} testId="stat-online-drivers" />
              <StatCard icon={Activity} label="Viajes activos" value={stats.activeTrips.toLocaleString()} testId="stat-active-trips" />
              <StatCard icon={Navigation} label="Viajes completados" value={stats.completedTrips.toLocaleString()} testId="stat-completed-trips" />
              <StatCard icon={Clock} label="Viajes pendientes" value={stats.pendingTrips?.toLocaleString() || '0'} testId="stat-pending-trips" />
              <StatCard icon={DollarSign} label="Ingresos totales" value={`$${stats.totalRevenue.toLocaleString('es-CO', { minimumFractionDigits: 0 })}`} sublabel="COP" testId="stat-total-revenue" />
            </div>
          ) : null}

          {/* ── Recent Activity ── */}
          <div>
            <h2 className="text-xl font-bold text-foreground mb-4">Actividad reciente</h2>
            <Card className="border-card-border overflow-hidden">
              {tripsLoading ? (
                <div className="p-6 space-y-4">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
                </div>
              ) : recentTrips && recentTrips.length > 0 ? (
                <div className="divide-y divide-border">
                  {recentTrips.map((trip) => (
                    <div key={trip.id} className="p-4 hover:bg-muted/30 transition-colors" data-testid={`trip-${trip.id}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-3">
                            <TripStatusBadge status={trip.status} />
                            <span className="text-xs text-muted-foreground font-mono">#{trip.id}</span>
                          </div>
                          <p className="text-sm text-foreground truncate">
                            <span className="text-muted-foreground">De:</span> {trip.originAddress}
                          </p>
                          <p className="text-sm text-foreground truncate">
                            <span className="text-muted-foreground">A:</span> {trip.destinationAddress}
                          </p>
                        </div>
                        <div className="text-right space-y-1 ml-4">
                          <p className="text-sm font-mono font-medium text-foreground">
                            ${trip.estimatedPrice.toLocaleString('es-CO')}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(trip.createdAt), 'dd MMM, HH:mm', { locale: es })}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-12 text-center">
                  <p className="text-muted-foreground">No hay actividad reciente</p>
                </div>
              )}
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
