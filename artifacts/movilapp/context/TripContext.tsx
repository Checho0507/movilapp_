import React, { createContext, useContext, useState, useCallback } from 'react';

export type TripStatus =
  | 'pending'
  | 'accepted'
  | 'driver_arriving'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export interface TripDriver {
  id: number;
  name: string;
  phone: string;
  rating: number;
  currentLat: number | null;
  currentLng: number | null;
}

export interface ActiveTrip {
  id: number;
  status: TripStatus;
  passengerId: number;
  driverId: number | null;
  originLat: number;
  originLng: number;
  originAddress: string;
  destinationLat: number;
  destinationLng: number;
  destinationAddress: string;
  estimatedPrice: number;
  finalPrice: number | null;
  vehicleType: string;
  paymentMethod: string;
  passenger?: { id: number; name: string; phone: string; rating: number } | null;
  driver?: TripDriver | null;
  createdAt: string;
}

interface TripContextType {
  activeTrip: ActiveTrip | null;
  setActiveTrip: (trip: ActiveTrip | null) => void;
  updateTripStatus: (status: TripStatus, data?: Partial<ActiveTrip>) => void;
  updateDriverLocation: (lat: number, lng: number) => void;
}

const TripContext = createContext<TripContextType>({
  activeTrip: null,
  setActiveTrip: () => {},
  updateTripStatus: () => {},
  updateDriverLocation: () => {},
});

export function TripProvider({ children }: { children: React.ReactNode }) {
  const [activeTrip, setActiveTripState] = useState<ActiveTrip | null>(null);

  const setActiveTrip = useCallback((trip: ActiveTrip | null) => setActiveTripState(trip), []);

  const updateTripStatus = useCallback((status: TripStatus, data?: Partial<ActiveTrip>) => {
    setActiveTripState(prev => (prev ? { ...prev, ...data, status } : null));
  }, []);

  const updateDriverLocation = useCallback((lat: number, lng: number) => {
    setActiveTripState(prev => {
      if (!prev) return null;
      const driver = prev.driver ? { ...prev.driver, currentLat: lat, currentLng: lng } : prev.driver;
      return { ...prev, driver };
    });
  }, []);

  return (
    <TripContext.Provider value={{ activeTrip, setActiveTrip, updateTripStatus, updateDriverLocation }}>
      {children}
    </TripContext.Provider>
  );
}

export function useTrip() {
  return useContext(TripContext);
}
