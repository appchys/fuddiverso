// Función para calcular ETA simple con fórmula Haversine (Alternativa gratis)
export function calculateETASimple(
    origin: { lat: number; lng: number },
    destination: string // latlong como string "lat,lng" o similar
): number | null {
    try {
        let destLat: number;
        let destLng: number;

        // Manejar formato "lat,lng" o "lat, lng"
        const parts = destination.split(',').map(s => s.trim());
        if (parts.length === 2) {
            destLat = parseFloat(parts[0]);
            destLng = parseFloat(parts[1]);
        } else {
            return null; // Formato no válido
        }

        if (isNaN(destLat) || isNaN(destLng)) return null;

        // Fórmula de Haversine para distancia en km
        const R = 6371; // Radio de la Tierra en km
        const dLat = (destLat - origin.lat) * Math.PI / 180;
        const dLng = (destLng - origin.lng) * Math.PI / 180;

        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(origin.lat * Math.PI / 180) * Math.cos(destLat * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distanceKm = R * c;

        // Asumir velocidad promedio de 15 km/h en bicicleta/moto en ciudad
        // Esto incluye paradas, tráfico, etc.
        const speedKmH = 15;

        const timeInHours = distanceKm / speedKmH;
        const timeInMinutes = Math.ceil(timeInHours * 60);

        // Agregar un margen base de 5 minutos para estacionamiento/entrega
        return timeInMinutes + 5;
    } catch (error) {
        console.error('Error calculating simple ETA:', error);
        return null;
    }
}
