import { useState } from "react";
import { useLocation } from "wouter";
import { useLoginUser } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const loginMutation = useLoginUser();
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    loginMutation.mutate(
      { data: { phone, password } },
      {
        onSuccess: (data) => {
          localStorage.setItem("token", data.token);
          toast({
            title: "Inicio de sesión exitoso",
            description: `Bienvenido, ${data.user.name}`,
          });
          setLocation("/dashboard");
        },
        onError: (error: any) => {
          toast({
            variant: "destructive",
            title: "Error de autenticación",
            description: error?.data?.error || "Credenciales inválidas",
          });
        },
      },
    );
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="w-full max-w-md p-8 space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-28 w-28 items-center justify-center overflow-hidden rounded-[26px] border border-border bg-[#08080F]">
            <img
              src={`${import.meta.env.BASE_URL}assets/logo.png`}
              alt="Logo de MovilApp"
              className="h-[90px] w-[90px] object-contain"
            />
          </div>
          <h1 className="mb-1 text-4xl font-bold tracking-tight text-foreground">
            MovilApp
          </h1>
          <p className="text-sm text-muted-foreground">
            Tu movilidad, a un toque
          </p>
          <p className="mt-3 text-xs font-mono text-primary">
            ADMIN CONTROL CENTER
          </p>
        </div>

        <div className="bg-card border border-card-border rounded-lg p-8 shadow-lg">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="phone" className="text-sm font-medium">
                Teléfono
              </Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+57 300 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="font-mono"
                data-testid="input-phone"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">
                Contraseña
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="input-password"
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={loginMutation.isPending}
              data-testid="button-submit"
            >
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Ingresando...
                </>
              ) : (
                "Ingresar"
              )}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Panel de administración exclusivo para operadores
        </p>
      </div>
    </div>
  );
}
