import { useState } from 'react';
import { GOOGLE_MAPS_API_KEY } from './GoogleMap';

export default function LocationMap({ latlong, height = "96px" }: { latlong: string; height?: string }) {
    const [imgError, setImgError] = useState(false);

    // Parsear las coordenadas del formato "-1.874907, -79.979742"
    const parseCoordinates = (coordString: string) => {
        try {
            const [lat, lng] = coordString.split(',').map(coord => parseFloat(coord.trim()));
            if (isNaN(lat) || isNaN(lng)) {
                return null;
            }
            return { lat, lng };
        } catch (error) {
            console.error('Error parsing coordinates:', error);
            return null;
        }
    };

    const coordinates = parseCoordinates(latlong);

    if (!coordinates) {
        return (
            <div className="w-full bg-gray-100 rounded-lg flex items-center justify-center" style={{ height }}>
                <span className="text-gray-500 text-xs">📍 Coordenadas inválidas</span>
            </div>
        );
    }

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY;
    const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${coordinates.lat},${coordinates.lng}&zoom=16&size=600x300&maptype=roadmap&markers=color:red%7C${coordinates.lat},${coordinates.lng}&key=${apiKey}`;

    if (imgError) {
        return (
            <div className="w-full h-full bg-gray-100 rounded-lg flex flex-col items-center justify-center text-gray-500 p-1 text-center" style={{ minHeight: height }}>
                <i className="bi bi-geo-alt-fill text-red-500 text-lg leading-none" />
                <span className="text-[10px] font-medium mt-0.5 truncate max-w-full">Mapa</span>
            </div>
        );
    }

    return (
        <div className="w-full h-full overflow-hidden relative bg-gray-100" style={{ minHeight: height }}>
            <img
                src={staticMapUrl}
                alt={`Mapa de ubicación ${coordinates.lat}, ${coordinates.lng}`}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={() => setImgError(true)}
            />
        </div>
    );
}
