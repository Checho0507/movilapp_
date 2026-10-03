# MóvilApp — App de Transporte

Plataforma de ride-sharing (tipo taxi/Uber) para Colombia. Los pasajeros solicitan viajes con matching en tiempo real, rastrean al conductor en el mapa, chatean y ven su historial. Los conductores se conectan/desconectan, aceptan solicitudes cercanas y navegan hacia los pasajeros.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — servidor API Express (puerto 8080, ruta `/api`)
- `pnpm --filter @workspace/movilapp run dev` — app móvil Expo (puerto 21280, ruta `/`)
- `pnpm run typecheck` — typecheck completo de todos los paquetes
- `pnpm run build` — typecheck + build todos los paquetes
- `pnpm --filter @workspace/api-spec run codegen` — regenerar hooks React Query y schemas Zod desde el spec OpenAPI
- `pnpm --filter @workspace/db run migrate` — sincronizar el esquema Drizzle y aplicar las migraciones SQL (solo dev/local)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- **API**: Express 5 + Socket.io (real-time trips, chat, driver location)
- **Mobile**: Expo (expo-router, React Native, react-native-maps)
- **DB**: PostgreSQL + Drizzle ORM
- **Auth**: JWT (`SESSION_SECRET` env var)
- **Validación**: Zod (`zod/v4`), `drizzle-zod`
- **Codegen API**: Orval (desde spec OpenAPI)
- **Build**: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — contrato OpenAPI (fuente de verdad)
- `lib/api-client-react/src/generated/` — hooks React Query generados (NO editar manualmente)
- `lib/db/src/schema/` — schemas Drizzle (users, trips, vehicles, messages, ratings, subscriptions, conversations)
- `artifacts/api-server/src/routes/` — rutas Express (auth, trips, drivers, vehicles, admin, conversations)
- `artifacts/movilapp/app/` — pantallas Expo Router (tabs: index, messages, history, profile; plus login, trip/[id], chat/[id])
- `artifacts/movilapp/context/` — AuthContext, SocketContext, TripContext

## Architecture decisions

- Real-time con Socket.io: conductores emiten ubicación, pasajeros la reciben vía rooms `driver:{id}`; viajes tienen room `trip:{id}`
- JWT con 30 días de expiración; token guardado en AsyncStorage
- Conductores nuevos reciben 60 días de prueba gratis (subscriptionsTable)
- Métodos de pago: cash + digitales (nequi, daviplata, breve)
- Mapa: react-native-maps en nativo, stub web en `lib/maps.tsx`

## Required env vars

- `DATABASE_URL` — Postgres connection string (provisionado por Replit)
- `SESSION_SECRET` — secreto JWT (configurado en Replit Secrets)

## Base de datos local

Para crear el esquema en una base PostgreSQL vacía, crea primero la base de datos,
configura `DATABASE_URL` con su URL local y ejecuta desde la raíz:

```sh
pnpm --filter @workspace/db run migrate
```

El comando aplica el esquema actual de `lib/db/src/schema` con Drizzle y luego
ejecuta, en orden, las migraciones SQL idempotentes de `lib/db/migrations`.
No copia datos de otra base; inicializa el esquema y los planes de suscripción
predeterminados necesarios por la aplicación. Ejecutarlo de nuevo es seguro.

## User preferences

_Populate as you build._

## Gotchas

- No editar manualmente `lib/api-client-react/src/generated/` — regenerar con codegen
- `react-native-maps` requiere versión 1.20.1 (compatible con Expo Go actual)
- NO agregar react-native-maps a plugins en app.json (causa crash)
- Para cambios en la BD usa `pnpm --filter @workspace/db run migrate` en local/dev; revisa los cambios antes de ejecutarlo contra producción
