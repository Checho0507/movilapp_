import { useState } from "react";
import { useListAdminTrips } from "@workspace/api-client-react";
import { Sidebar } from "@/components/sidebar";
import { TripStatusBadge } from "@/components/trip-status-badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Navigation2, MapPin } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function TripsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const params: any = {};
  if (statusFilter !== "all") params.status = statusFilter;

  const {
    data: trips,
    isLoading,
    isError,
    refetch,
  } = useListAdminTrips(params);

  const filteredTrips =
    trips?.filter(
      (trip) =>
        trip.originAddress.toLowerCase().includes(search.toLowerCase()) ||
        (trip.destinationAddress ?? "")
          .toLowerCase()
          .includes(search.toLowerCase()) ||
        trip.passenger?.name?.toLowerCase().includes(search.toLowerCase()) ||
        trip.driver?.name?.toLowerCase().includes(search.toLowerCase()),
    ) || [];

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />

      <main className="flex-1 p-8 overflow-auto">
        <div className="max-w-7xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Viajes</h1>
            <p className="text-sm text-muted-foreground">
              Registro completo de viajes en la plataforma
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por dirección, pasajero o conductor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
                data-testid="input-search"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger
                className="w-full sm:w-56"
                data-testid="select-status"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="pending">Pendiente</SelectItem>
                <SelectItem value="accepted">Aceptado</SelectItem>
                <SelectItem value="driver_arriving">En camino</SelectItem>
                <SelectItem value="in_progress">En curso</SelectItem>
                <SelectItem value="completed">Completado</SelectItem>
                <SelectItem value="cancelled">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card className="border-card-border overflow-hidden">
            {isLoading ? (
              <div className="p-6 space-y-4">
                {Array.from({ length: 10 }).map((_, i) => (
                  <Skeleton key={i} className="h-28" />
                ))}
              </div>
            ) : isError ? (
              <div className="p-12 text-center space-y-3">
                <p className="text-sm text-destructive">
                  No se pudieron cargar los viajes.
                </p>
                <button
                  className="text-sm text-primary underline"
                  onClick={() => refetch()}
                >
                  Reintentar
                </button>
              </div>
            ) : filteredTrips.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/30 border-b border-border">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        ID
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Estado
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Ruta
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Pasajero
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Conductor
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Vehículo
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Precio
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Pago
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Fecha
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredTrips.map((trip) => (
                      <tr
                        key={trip.id}
                        className="hover:bg-muted/20 transition-colors"
                        data-testid={`trip-${trip.id}`}
                      >
                        <td className="px-6 py-4">
                          <p className="text-sm font-mono text-primary">
                            #{trip.id}
                          </p>
                        </td>
                        <td className="px-6 py-4">
                          <TripStatusBadge status={trip.status} />
                        </td>
                        <td className="px-6 py-4 max-w-xs">
                          <div className="space-y-2">
                            <div className="flex items-start gap-2">
                              <Navigation2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                              <p className="text-sm text-foreground line-clamp-1">
                                {trip.originAddress}
                              </p>
                            </div>
                            <div className="flex items-start gap-2">
                              <MapPin className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                              <p className="text-sm text-foreground line-clamp-1">
                                {trip.destinationAddress ??
                                  (trip.destinationPending
                                    ? "Destino pendiente"
                                    : "Sin destino")}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm text-foreground">
                            {trip.passenger?.name || "N/A"}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono">
                            {trip.passenger?.phone}
                          </p>
                        </td>
                        <td className="px-6 py-4">
                          {trip.driver ? (
                            <>
                              <p className="text-sm text-foreground">
                                {trip.driver.name}
                              </p>
                              <p className="text-xs text-muted-foreground font-mono">
                                {trip.driver.phone}
                              </p>
                            </>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              Sin asignar
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <Badge variant="outline" className="font-mono">
                            {trip.vehicleType}
                          </Badge>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm font-mono font-medium text-foreground">
                            $
                            {(
                              trip.finalPrice || trip.estimatedPrice
                            ).toLocaleString("es-CO")}
                          </p>
                          {trip.distanceKm && (
                            <p className="text-xs text-muted-foreground">
                              {trip.distanceKm.toFixed(1)} km
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <Badge
                            variant="outline"
                            className={
                              trip.paymentMethod === "cash"
                                ? "bg-green-500/20 text-green-400 border-green-500/30"
                                : "bg-blue-500/20 text-blue-400 border-blue-500/30"
                            }
                          >
                            {trip.paymentMethod === "cash"
                              ? "Efectivo"
                              : "Tarjeta"}
                          </Badge>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm text-muted-foreground">
                            {format(new Date(trip.createdAt), "dd MMM", {
                              locale: es,
                            })}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono">
                            {format(new Date(trip.createdAt), "HH:mm")}
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
                  No se encontraron viajes
                </p>
              </div>
            )}
          </Card>

          {filteredTrips.length > 0 && (
            <div className="text-sm text-muted-foreground text-center">
              Mostrando {filteredTrips.length} viaje(s)
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
