import { Link, useLocation } from 'wouter';
import { LayoutDashboard, Users, Car, Navigation, LogOut, CreditCard, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGetMe } from '@workspace/api-client-react';

interface NavItemProps {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
}

function NavItem({ href, icon: Icon, label, active }: NavItemProps) {
  return (
    <Link href={href}>
      <div
        className={`flex items-center gap-3 px-4 py-2.5 rounded-md transition-all cursor-pointer ${
          active
            ? 'bg-primary text-primary-foreground font-medium'
            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
        }`}
        data-testid={`nav-${label.toLowerCase().replace(/\s/g, '-')}`}
      >
        <Icon className="w-5 h-5 shrink-0" />
        <span className="text-sm">{label}</span>
      </div>
    </Link>
  );
}

export function Sidebar() {
  const [location] = useLocation();
  const { data: user } = useGetMe();

  const handleLogout = () => {
    localStorage.removeItem('token');
    window.location.href = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/login`;
  };

  return (
    <aside className="w-64 h-screen bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-sidebar-border bg-[#08080F]">
            <img
              src={`${import.meta.env.BASE_URL}assets/logo.png`}
              alt="Logo de MovilApp"
              className="h-10 w-10 object-contain"
            />
          </div>
          <div>
            <h1 className="text-xl font-bold text-primary tracking-tight">MovilApp</h1>
            <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
              CONTROL CENTER
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        <NavItem
          href="/dashboard"
          icon={LayoutDashboard}
          label="Dashboard"
          active={location === '/dashboard' || location === '/'}
        />
        <NavItem
          href="/users"
          icon={Users}
          label="Usuarios"
          active={location === '/users'}
        />
        <NavItem
          href="/trips"
          icon={Navigation}
          label="Viajes"
          active={location === '/trips'}
        />
        <NavItem
          href="/drivers"
          icon={Car}
          label="Conductores"
          active={location === '/drivers'}
        />
        <NavItem
          href="/subscriptions"
          icon={CreditCard}
          label="Suscripciones"
          active={location === '/subscriptions'}
        />
        <NavItem
          href="/support"
          icon={MessageSquare}
          label="Soporte"
          active={location === '/support'}
        />
      </nav>

      {user && (
        <div className="p-4 border-t border-sidebar-border">
          <div className="mb-3">
            <p className="text-sm font-medium text-sidebar-foreground">
              {user.name}
            </p>
            <p className="text-xs text-muted-foreground font-mono">
              {user.phone}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            className="w-full"
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Cerrar sesión
          </Button>
        </div>
      )}
    </aside>
  );
}
