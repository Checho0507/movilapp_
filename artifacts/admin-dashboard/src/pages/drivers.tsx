import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListAdminUsers } from "@workspace/api-client-react";
import { Sidebar } from "@/components/sidebar";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Star, Car, CreditCard } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface SubInfo {
  driverId: number;
  plan: string;
  planLabel: string;
  isTrial: boolean;
  isActive: boolean;
  daysRemaining: number;
  expiresAt: string;
}

const API = () => `${window.location.origin}/api`;
async function fetchSubs(): Promise<SubInfo[]> {
  const res = await fetch(`${API()}/admin/subscriptions?limit=500`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` },
  });
  if (!res.ok) return [];
  const all: SubInfo[] = await res.json();
  // Keep only the most-recent subscription per driver
  const map = new Map<number, SubInfo>();
  for (const s of all) {
    const prev = map.get(s.driverId);
    if (
      !prev ||
      (s.isActive && !prev.isActive) ||
      new Date(s.expiresAt) > new Date(prev.expiresAt)
    ) {
      map.set(s.driverId, s);
    }
  }
  return [...map.values()];
}

function SubBadge({ sub }: { sub: SubInfo | undefined }) {
  if (!sub)
    return (
      <Badge
        variant="outline"
        className="bg-gray-500/15 text-gray-400 border-gray-500/30"
      >
        Sin plan
      </Badge>
    );
  if (!sub.isActive)
    return (
      <Badge
        variant="outline"
        className="bg-red-500/15 text-red-400 border-red-500/30"
      >
        Vencida
      </Badge>
    );
  if (sub.isTrial)
    return (
      <Badge
        variant="outline"
        className="bg-amber-500/15 text-amber-400 border-amber-500/30"
      >
        Prueba · {sub.daysRemaining}d
      </Badge>
    );
  return (
    <Badge
      variant="outline"
      className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    >
      {sub.planLabel} · {sub.daysRemaining}d
    </Badge>
  );
}

export default function DriversPage() {
  const [search, setSearch] = useState("");

  const { data: users, isLoading } = useListAdminUsers({ role: "driver" });
  const { data: subs = [] } = useQuery<SubInfo[]>({
    queryKey: ["driver-subs-index"],
    queryFn: fetchSubs,
  });
  const subByDriver = new Map(subs.map((s) => [s.driverId, s]));

  const filteredDrivers =
    users?.filter(
      (driver) =>
        driver.name.toLowerCase().includes(search.toLowerCase()) ||
        driver.phone.includes(search),
    ) || [];

  const onlineDrivers = filteredDrivers.filter((d) => d.isOnline);
  const offlineDrivers = filteredDrivers.filter((d) => !d.isOnline);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />

      <main className="flex-1 p-8 overflow-auto">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">
                Conductores
              </h1>
              <p className="text-sm text-muted-foreground">
                Gestión de conductores activos en la plataforma
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-2xl font-bold font-mono text-primary">
                  {onlineDrivers.length}
                </p>
                <p className="text-xs text-muted-foreground">EN LÍNEA</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold font-mono text-muted-foreground">
                  {offlineDrivers.length}
                </p>
                <p className="text-xs text-muted-foreground">DESCONECTADOS</p>
              </div>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar conductor por nombre o teléfono..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
              data-testid="input-search"
            />
          </div>

          <Card className="border-card-border overflow-hidden">
            {isLoading ? (
              <div className="p-6 space-y-4">
                {Array.from({ length: 10 }).map((_, i) => (
                  <Skeleton key={i} className="h-24" />
                ))}
              </div>
            ) : filteredDrivers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/30 border-b border-border">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Conductor
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Teléfono
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Estado
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Rating
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Viajes
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Cuenta
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Suscripción
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Registro
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredDrivers.map((driver) => (
                      <tr
                        key={driver.id}
                        className="hover:bg-muted/20 transition-colors"
                        data-testid={`driver-${driver.id}`}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                              <Car className="w-6 h-6 text-primary" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                {driver.name}
                              </p>
                              {driver.isOnline && (
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <div className="w-2 h-2 rounded-full bg-green-400 pulse-glow" />
                                  <p className="text-xs text-green-400 font-mono">
                                    EN LÍNEA
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm font-mono text-foreground">
                            {driver.phone}
                          </p>
                        </td>
                        <td className="px-6 py-4">
                          <Badge
                            variant="outline"
                            className={
                              driver.isOnline
                                ? "bg-green-500/20 text-green-400 border-green-500/30"
                                : "bg-gray-500/20 text-gray-400 border-gray-500/30"
                            }
                          >
                            {driver.isOnline ? "En línea" : "Desconectado"}
                          </Badge>
                        </td>
                        <td className="px-6 py-4">
                          {driver.ratingCount > 0 ? (
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1">
                                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                                <span className="text-sm font-mono font-medium text-foreground">
                                  {driver.rating.toFixed(1)}
                                </span>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                ({driver.ratingCount} reviews)
                              </span>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              Sin rating
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm font-mono text-foreground">
                            {"completedTrips" in driver &&
                            typeof driver.completedTrips === "number"
                              ? driver.completedTrips
                              : 0}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            completados
                          </p>
                        </td>
                        <td className="px-6 py-4">
                          <Badge
                            variant="outline"
                            className={
                              driver.isActive
                                ? "bg-green-500/20 text-green-400 border-green-500/30"
                                : "bg-red-500/20 text-red-400 border-red-500/30"
                            }
                          >
                            {driver.isActive ? "Activa" : "Bloqueada"}
                          </Badge>
                        </td>
                        <td className="px-6 py-4">
                          <SubBadge sub={subByDriver.get(driver.id)} />
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm text-muted-foreground">
                            {format(new Date(driver.createdAt), "dd MMM yyyy", {
                              locale: es,
                            })}
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-12 text-center">
                <p className="text-muted-foreground">
                  No se encontraron conductores
                </p>
              </div>
            )}
          </Card>

          {filteredDrivers.length > 0 && (
            <div className="text-sm text-muted-foreground text-center">
              Mostrando {filteredDrivers.length} conductor(es) •{" "}
              {onlineDrivers.length} en línea • {offlineDrivers.length}{" "}
              desconectados
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
