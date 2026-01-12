export default function LocationMap({ latlong, height = "96px" }: { latlong: string; height?: string }) {
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

    // Usar Google Static Maps API con un tamaño mayor para mejor resolución en anchos grandes
    const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${coordinates.lat},${coordinates.lng}&zoom=16&size=600x300&maptype=roadmap&markers=color:red%7C${coordinates.lat},${coordinates.lng}&key=AIzaSyAgOiLYPpzxlUHkX3lCmp5KK4UF7wx7zMs`;

    return (
        <div className="w-full h-full overflow-hidden relative" style={{ minHeight: height }}>
            <img
                src={staticMapUrl}
                alt={`Mapa de ubicación ${coordinates.lat}, ${coordinates.lng}`}
                className="w-full h-full object-cover"
            />
        </div>
    );
}
