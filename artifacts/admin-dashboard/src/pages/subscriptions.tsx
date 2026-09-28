import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sidebar } from '@/components/sidebar';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  CreditCard, TrendingUp, Users, AlertCircle, Plus, Search, Calendar, RefreshCw,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { useListAdminUsers } from '@workspace/api-client-react';

interface Plan { key: string; label: string; days: number; priceCop: number; }

// ─── API helper ───────────────────────────────────────────────────────────────
const API = () => `${window.location.origin}/api`;
const authHeader = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('token') ?? ''}`,
});

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API()}${path}`, { ...opts, headers: authHeader() });
  const data = await res.json();
  if (!res.ok) throw data;
  return data as T;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Sub {
  id: number;
  driverId: number;
  plan: string;
  planLabel: string;
  priceCop: number;
  startsAt: string;
  expiresAt: string;
  isTrial: boolean;
  isActive: boolean;
  daysRemaining: number;
  notes: string | null;
  createdAt: string;
  driver: { id: number; name: string; phone: string } | null;
}

interface Stats {
  active: number;
  trial: number;
  expired: number;
  monthlyRevenueCop: number;
  totalRevenueCop: number;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sublabel, color }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sublabel?: string;
  color?: string;
}) {
  return (
    <Card className="p-6 border-card-border hover:border-primary/40 transition-colors">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
          <p className={`text-3xl font-bold font-mono ${color ?? 'text-foreground'}`}>{value}</p>
          {sublabel && <p className="text-xs text-muted-foreground mt-1 font-mono">{sublabel}</p>}
        </div>
        <div className="p-3 bg-primary/10 rounded-lg">
          <Icon className="w-6 h-6 text-primary" />
        </div>
      </div>
    </Card>
  );
}

function SubStatusBadge({ sub }: { sub: Sub }) {
  if (!sub.isActive) {
    return <Badge variant="outline" className="bg-red-500/15 text-red-400 border-red-500/30">Vencida</Badge>;
  }
  if (sub.isTrial) {
    return <Badge variant="outline" className="bg-amber-500/15 text-amber-400 border-amber-500/30">Prueba</Badge>;
  }
  return <Badge variant="outline" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">Activa</Badge>;
}

function PlanBadge({ plan }: { plan: string }) {
  const colors: Record<string, string> = {
    monthly:  'bg-violet-500/15 text-violet-400 border-violet-500/30',
    biweekly: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    weekly:   'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    daily:    'bg-slate-500/15 text-slate-400 border-slate-500/30',
    trial:    'bg-amber-500/15 text-amber-400 border-amber-500/30',
  };
  const labels: Record<string, string> = {
    monthly: 'Mensual', biweekly: 'Quincenal', weekly: 'Semanal', daily: 'Diario', trial: 'Prueba',
  };
  return (
    <Badge variant="outline" className={colors[plan] ?? 'bg-muted/20 text-muted-foreground border-border'}>
      {labels[plan] ?? plan}
    </Badge>
  );
}

function formatCOP(n: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function SubscriptionsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showAssign, setShowAssign] = useState(false);

  // Assign form state
  const [selDriverId, setSelDriverId] = useState<string>('');
  const [selPlan, setSelPlan] = useState<string>('');
  const [selNotes, setSelNotes] = useState('');
  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['subscription-plans'],
    queryFn: () => apiFetch('/admin/subscriptions/plans'),
  });

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: stats, isLoading: statsLoading } = useQuery<Stats>({
    queryKey: ['sub-stats'],
    queryFn: () => apiFetch('/admin/subscriptions/stats'),
  });

  const params = new URLSearchParams();
  if (planFilter !== 'all') params.set('plan', planFilter);
  if (statusFilter !== 'all') params.set('status', statusFilter);

  const { data: subs = [], isLoading: subsLoading } = useQuery<Sub[]>({
    queryKey: ['subscriptions', planFilter, statusFilter],
    queryFn: () => apiFetch(`/admin/subscriptions?${params}`),
  });

  const { data: drivers = [] } = useListAdminUsers({ role: 'driver' });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const assignPlan = useMutation({
    mutationFn: (body: { driverId: number; plan: string; notes?: string }) =>
      apiFetch('/admin/subscriptions', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['sub-stats'] });
      setShowAssign(false);
      setSelDriverId('');
      setSelPlan('');
      setSelNotes('');
      toast({ title: '✅ Plan asignado', description: 'La suscripción fue creada exitosamente.' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err?.error ?? 'No se pudo asignar el plan.', variant: 'destructive' });
    },
  });

  const handleAssign = () => {
    if (!selDriverId || !selPlan) return;
    assignPlan.mutate({
      driverId: Number(selDriverId),
      plan: selPlan,
      notes: selNotes.trim() || undefined,
    });
  };

  // ── Filtered subs ──────────────────────────────────────────────────────────
  const filtered = subs.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.driver?.name.toLowerCase().includes(q) ||
      s.driver?.phone.includes(q)
    );
  });

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />

      <main className="flex-1 p-8 overflow-auto">
        <div className="max-w-7xl mx-auto space-y-6">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">Suscripciones</h1>
              <p className="text-sm text-muted-foreground">
                Gestión de planes de conductores configurados en la base de datos
              </p>
            </div>
            <Button onClick={() => setShowAssign(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              Asignar plan
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {statsLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
            ) : (
              <>
                <StatCard icon={Users} label="Activas (pagadas)" value={stats?.active ?? 0} color="text-emerald-400" />
                <StatCard icon={Calendar} label="En período de prueba" value={stats?.trial ?? 0} color="text-amber-400" />
                <StatCard icon={AlertCircle} label="Vencidas" value={stats?.expired ?? 0} color="text-red-400" />
                <StatCard
                  icon={TrendingUp}
                  label="Ingresos este mes"
                  value={formatCOP(stats?.monthlyRevenueCop ?? 0)}
                  sublabel={`Total acum.: ${formatCOP(stats?.totalRevenueCop ?? 0)}`}
                  color="text-primary"
                />
              </>
            )}
          </div>

          {/* Plans reference */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {plans.filter(p => p.key !== 'trial').map(p => (
              <Card
                key={p.key}
                className="p-4 border-card-border text-center hover:border-primary/40 cursor-pointer transition-colors"
                onClick={() => setPlanFilter(p.key)}
              >
                <p className="text-lg font-bold font-mono text-primary">{formatCOP(p.priceCop)}</p>
                <p className="text-sm font-semibold text-foreground mt-1">{p.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{p.days} día{p.days > 1 ? 's' : ''}</p>
              </Card>
            ))}
          </div>

          {/* Filters */}
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por conductor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={planFilter} onValueChange={setPlanFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Plan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los planes</SelectItem>
                {plans.map(p => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="active">Activas</SelectItem>
                <SelectItem value="trial">En prueba</SelectItem>
                <SelectItem value="expired">Vencidas</SelectItem>
              </SelectContent>
            </Select>
            {(planFilter !== 'all' || statusFilter !== 'all' || search) && (
              <Button variant="ghost" size="icon" onClick={() => { setPlanFilter('all'); setStatusFilter('all'); setSearch(''); }}>
                <RefreshCw className="w-4 h-4" />
              </Button>
            )}
          </div>

          {/* Table */}
          <Card className="border-card-border overflow-hidden">
            {subsLoading ? (
              <div className="p-6 space-y-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
            ) : filtered.length === 0 ? (
              <div className="p-16 text-center">
                <CreditCard className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
                <p className="text-muted-foreground">No hay suscripciones con estos filtros</p>
                <Button variant="link" className="mt-2" onClick={() => setShowAssign(true)}>
                  Asignar el primer plan →
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/30 border-b border-border">
                    <tr>
                      {['Conductor', 'Plan', 'Estado', 'Valor', 'Inicia', 'Vence', 'Tiempo restante', 'Notas'].map((h) => (
                        <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map((sub) => (
                      <tr key={sub.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-5 py-4">
                          <p className="text-sm font-semibold text-foreground">{sub.driver?.name ?? '—'}</p>
                          <p className="text-xs text-muted-foreground font-mono">{sub.driver?.phone ?? '—'}</p>
                        </td>
                        <td className="px-5 py-4">
                          <PlanBadge plan={sub.plan} />
                        </td>
                        <td className="px-5 py-4">
                          <SubStatusBadge sub={sub} />
                        </td>
                        <td className="px-5 py-4">
                          <p className={`text-sm font-mono font-bold ${sub.isTrial ? 'text-muted-foreground' : 'text-primary'}`}>
                            {sub.isTrial ? 'Gratis' : formatCOP(sub.priceCop)}
                          </p>
                        </td>
                        <td className="px-5 py-4 text-sm text-muted-foreground whitespace-nowrap">
                          {format(new Date(sub.startsAt), 'dd MMM yyyy', { locale: es })}
                        </td>
                        <td className="px-5 py-4 text-sm text-muted-foreground whitespace-nowrap">
                          {format(new Date(sub.expiresAt), 'dd MMM yyyy', { locale: es })}
                        </td>
                        <td className="px-5 py-4">
                          {sub.isActive ? (
                            <span className="text-sm font-mono text-emerald-400">
                              {sub.daysRemaining} día{sub.daysRemaining !== 1 ? 's' : ''}
                            </span>
                          ) : (
                            <span className="text-xs text-red-400">
                              Venció {formatDistanceToNow(new Date(sub.expiresAt), { locale: es, addSuffix: true })}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4 max-w-[160px]">
                          <p className="text-xs text-muted-foreground truncate">{sub.notes ?? '—'}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {filtered.length > 0 && (
            <p className="text-sm text-muted-foreground text-center">
              {filtered.length} registro{filtered.length !== 1 ? 's' : ''} ·{' '}
              {subs.filter((s) => s.isActive && !s.isTrial).length} activas ·{' '}
              {subs.filter((s) => s.isTrial && s.isActive).length} en prueba ·{' '}
              {subs.filter((s) => !s.isActive).length} vencidas
            </p>
          )}
        </div>
      </main>

      {/* ── Assign Plan Modal ─────────────────────────────────────────────── */}
      <Dialog open={showAssign} onOpenChange={setShowAssign}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Asignar plan a conductor</DialogTitle>
            <DialogDescription>
              Registra el pago recibido y activa el plan del conductor.
              La suscripción inicia inmediatamente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Driver selector */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Conductor</label>
              <Select value={selDriverId} onValueChange={setSelDriverId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un conductor..." />
                </SelectTrigger>
                <SelectContent>
                  {drivers.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.name} · {d.phone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Plan selector — cards */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Plan</label>
              <div className="grid grid-cols-2 gap-2">
                {plans.filter(p => p.key !== 'trial').map(p => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setSelPlan(p.key)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      selPlan === p.key
                        ? 'border-primary bg-primary/10 ring-1 ring-primary'
                        : 'border-border hover:border-primary/50 bg-card'
                    }`}
                  >
                    <p className="text-base font-bold font-mono text-primary">{formatCOP(p.priceCop)}</p>
                    <p className="text-sm font-semibold text-foreground">{p.label}</p>
                    <p className="text-xs text-muted-foreground">{p.days} día{p.days > 1 ? 's' : ''}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Notas <span className="text-muted-foreground font-normal">(opcional)</span>
              </label>
              <Input
                placeholder="Ej: Pagó en efectivo · Nequi ·..."
                value={selNotes}
                onChange={(e) => setSelNotes(e.target.value)}
              />
            </div>

            {/* Summary */}
            {selDriverId && selPlan && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm space-y-1">
                <p className="font-semibold text-foreground">Resumen</p>
                <p className="text-muted-foreground">
                  Conductor: <span className="text-foreground">{drivers.find((d) => d.id === Number(selDriverId))?.name}</span>
                </p>
                <p className="text-muted-foreground">
                  Plan: <span className="text-foreground">{plans.find(p => p.key === selPlan)?.label} · {plans.find(p => p.key === selPlan)?.days} día{(plans.find(p => p.key === selPlan)?.days ?? 0) > 1 ? 's' : ''}</span>
                </p>
                <p className="text-muted-foreground">
                  Valor: <span className="font-bold text-primary font-mono">{formatCOP(plans.find(p => p.key === selPlan)?.priceCop ?? 0)}</span>
                </p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowAssign(false)}>
                Cancelar
              </Button>
              <Button
                className="flex-1"
                disabled={!selDriverId || !selPlan || assignPlan.isPending}
                onClick={handleAssign}
              >
                {assignPlan.isPending ? 'Guardando...' : 'Confirmar plan'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
