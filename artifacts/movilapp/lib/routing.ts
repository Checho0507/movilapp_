export type RoutePoint = {
  latitude: number;
  longitude: number;
};

type Coordinates = {
  lat: number;
  lng: number;
};

type OsrmResponse = {
  code?: unknown;
  routes?: Array<{
    geometry?: {
      coordinates?: unknown;
    };
  }>;
};

export async function fetchDrivingRoute(
  origin: Coordinates,
  destination: Coordinates,
  signal?: AbortSignal,
): Promise<RoutePoint[]> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${origin.lng},${origin.lat};${destination.lng},${destination.lat}` +
    '?overview=full&geometries=geojson';
  const response = await fetch(url, {
    headers: { 'User-Agent': 'MovilApp/1.0' },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Route service returned HTTP ${response.status}`);
  }

  const result = (await response.json()) as OsrmResponse;
  const coordinates = result.routes?.[0]?.geometry?.coordinates;
  if (result.code !== 'Ok' || !Array.isArray(coordinates) || coordinates.length < 2) {
    throw new Error('Route service returned no usable route');
  }

  return coordinates.map((coordinate) => {
    if (
      !Array.isArray(coordinate) ||
      typeof coordinate[0] !== 'number' ||
      typeof coordinate[1] !== 'number' ||
      !Number.isFinite(coordinate[0]) ||
      !Number.isFinite(coordinate[1])
    ) {
      throw new Error('Route service returned invalid coordinates');
    }
    return { latitude: coordinate[1], longitude: coordinate[0] };
  });
}
