import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminUsers,
  getListAdminUsersQueryKey,
  getGetAdminStatsQueryKey,
  useUpdateUserStatus,
} from "@workspace/api-client-react";
import { Sidebar } from "@/components/sidebar";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Search, Star } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function UsersPage() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const params: any = {};
  if (roleFilter !== "all") params.role = roleFilter;
  if (statusFilter !== "all") params.isActive = statusFilter === "active";

  const {
    data: users,
    isLoading,
    isError,
    refetch,
  } = useListAdminUsers(params);
  const updateStatus = useUpdateUserStatus();

  const filteredUsers =
    users?.filter(
      (user) =>
        user.name.toLowerCase().includes(search.toLowerCase()) ||
        user.phone.includes(search),
    ) || [];

  const handleToggleStatus = (userId: number, currentStatus: boolean) => {
    updateStatus.mutate(
      { id: userId, data: { isActive: !currentStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListAdminUsersQueryKey(params),
          });
          queryClient.invalidateQueries({
            queryKey: getGetAdminStatsQueryKey(),
          });
          toast({
            title: "Estado actualizado",
            description: `Usuario ${!currentStatus ? "activado" : "bloqueado"} exitosamente`,
          });
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: "Error",
            description: "No se pudo actualizar el estado del usuario",
          });
        },
      },
    );
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />

      <main className="flex-1 p-8 overflow-auto">
        <div className="max-w-7xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Usuarios
            </h1>
            <p className="text-sm text-muted-foreground">
              Gestión de pasajeros, conductores y administradores
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre o teléfono..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
                data-testid="input-search"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger
                className="w-full sm:w-48"
                data-testid="select-role"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los roles</SelectItem>
                <SelectItem value="passenger">Pasajeros</SelectItem>
                <SelectItem value="driver">Conductores</SelectItem>
                <SelectItem value="admin">Administradores</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger
                className="w-full sm:w-48"
                data-testid="select-status"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="active">Activos</SelectItem>
                <SelectItem value="blocked">Bloqueados</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card className="border-card-border overflow-hidden">
            {isLoading ? (
              <div className="p-6 space-y-4">
                {Array.from({ length: 10 }).map((_, i) => (
                  <Skeleton key={i} className="h-20" />
                ))}
              </div>
            ) : isError ? (
              <div className="p-12 text-center space-y-3">
                <p className="text-sm text-destructive">
                  No se pudieron cargar los usuarios.
                </p>
                <button
                  className="text-sm text-primary underline"
                  onClick={() => refetch()}
                >
                  Reintentar
                </button>
              </div>
            ) : filteredUsers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/30 border-b border-border">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Usuario
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Teléfono
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Rol
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Rating
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Estado
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Registro
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredUsers.map((user) => (
                      <tr
                        key={user.id}
                        className="hover:bg-muted/20 transition-colors"
                        data-testid={`user-${user.id}`}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                              <span className="text-sm font-medium text-primary">
                                {user.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                {user.name}
                              </p>
                              {user.isOnline && (
                                <p className="text-xs text-green-400 font-mono">
                                  EN LÍNEA
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm font-mono text-foreground">
                            {user.phone}
                          </p>
                        </td>
                        <td className="px-6 py-4">
                          <Badge
                            variant="outline"
                            className={
                              user.role === "driver"
                                ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                                : user.role === "admin"
                                  ? "bg-purple-500/20 text-purple-400 border-purple-500/30"
                                  : "bg-gray-500/20 text-gray-400 border-gray-500/30"
                            }
                          >
                            {user.role === "passenger"
                              ? "Pasajero"
                              : user.role === "driver"
                                ? "Conductor"
                                : "Admin"}
                          </Badge>
                        </td>
                        <td className="px-6 py-4">
                          {user.ratingCount > 0 ? (
                            <div className="flex items-center gap-1">
                              <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                              <span className="text-sm font-mono text-foreground">
                                {user.rating.toFixed(1)}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                ({user.ratingCount})
                              </span>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              Sin rating
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <Badge
                            variant="outline"
                            className={
                              user.isActive
                                ? "bg-green-500/20 text-green-400 border-green-500/30"
                                : "bg-red-500/20 text-red-400 border-red-500/30"
                            }
                          >
                            {user.isActive ? "Activo" : "Bloqueado"}
                          </Badge>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm text-muted-foreground">
                            {format(new Date(user.createdAt), "dd MMM yyyy", {
                              locale: es,
                            })}
                          </p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={user.isActive}
                              onCheckedChange={() =>
                                handleToggleStatus(user.id, user.isActive)
                              }
                              disabled={updateStatus.isPending}
                              data-testid={`switch-user-${user.id}`}
                            />
                            <span className="text-xs text-muted-foreground">
                              {user.isActive ? "Activo" : "Bloqueado"}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-12 text-center">
                <p className="text-muted-foreground">
                  No se encontraron usuarios
                </p>
              </div>
            )}
          </Card>

          {filteredUsers.length > 0 && (
            <div className="text-sm text-muted-foreground text-center">
              Mostrando {filteredUsers.length} usuario(s)
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
