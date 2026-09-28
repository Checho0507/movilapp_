import { Badge } from "@/components/ui/badge";
import { TripStatus } from "@workspace/api-client-react";

interface TripStatusBadgeProps {
  status: TripStatus;
  className?: string;
}

const statusConfig: Record<TripStatus, { label: string; className: string }> = {
  pending: {
    label: "Pendiente",
    className: "bg-amber-500/20 text-amber-400 border-amber-500/30 font-mono",
  },
  accepted: {
    label: "Aceptado",
    className: "bg-blue-500/20 text-blue-400 border-blue-500/30 font-mono",
  },
  driver_arriving: {
    label: "En camino",
    className:
      "bg-indigo-500/20 text-indigo-400 border-indigo-500/30 font-mono",
  },
  in_progress: {
    label: "En curso",
    className:
      "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-mono",
  },
  completed: {
    label: "Completado",
    className: "bg-green-600/20 text-green-400 border-green-600/30 font-mono",
  },
  cancelled: {
    label: "Cancelado",
    className: "bg-red-500/20 text-red-400 border-red-500/30 font-mono",
  },
};

export function TripStatusBadge({ status, className }: TripStatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <Badge
      variant="outline"
      className={`${config.className} ${className || ""}`}
      data-testid={`badge-status-${status}`}
    >
      {config.label}
    </Badge>
  );
}
