import { Component, type ErrorInfo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { ProtectedRoute } from '@/components/protected-route';
import NotFound from '@/pages/not-found';
import LoginPage from '@/pages/login';
import DashboardPage from '@/pages/dashboard';
import UsersPage from '@/pages/users';
import TripsPage from '@/pages/trips';
import DriversPage from '@/pages/drivers';
import SubscriptionsPage from '@/pages/subscriptions';
import SupportPage from '@/pages/support';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; recoveryKey: number; automaticRecoveryUsed: boolean }
> {
  state = { error: null as Error | null, recoveryKey: 0, automaticRecoveryUsed: false };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Admin dashboard render failed', error, info.componentStack);
    if (
      !this.state.automaticRecoveryUsed &&
      error.message.includes('removeChild')
    ) {
      window.setTimeout(() => {
        this.setState((state) => ({
          error: null,
          recoveryKey: state.recoveryKey + 1,
          automaticRecoveryUsed: true,
        }));
      }, 0);
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-xl font-bold">No se pudo cargar esta sección</h1>
            <p className="text-sm text-muted-foreground">{this.state.error.message}</p>
            <button
              className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
              onClick={() => this.setState((state) => ({
                error: null,
                recoveryKey: state.recoveryKey + 1,
                automaticRecoveryUsed: false,
              }))}
            >
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    return <div key={this.state.recoveryKey}>{this.props.children}</div>;
  }
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/dashboard">
        <ProtectedRoute>
          <DashboardPage />
        </ProtectedRoute>
      </Route>
      <Route path="/users">
        <ProtectedRoute>
          <UsersPage />
        </ProtectedRoute>
      </Route>
      <Route path="/trips">
        <ProtectedRoute>
          <TripsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/drivers">
        <ProtectedRoute>
          <DriversPage />
        </ProtectedRoute>
      </Route>
      <Route path="/subscriptions">
        <ProtectedRoute>
          <SubscriptionsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/support">
        <ProtectedRoute>
          <SupportPage />
        </ProtectedRoute>
      </Route>
      <Route path="/">
        <ProtectedRoute>
          <DashboardPage />
        </ProtectedRoute>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppErrorBoundary>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
        </AppErrorBoundary>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
