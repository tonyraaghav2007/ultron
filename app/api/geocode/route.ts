import { NextResponse } from 'next/server';

// Known fallback coordinates for common references
const KNOWN_COORDS: Record<string, [number, number]> = {
  "mohali": [30.7046, 76.7179],
  "mohali, punjab": [30.7046, 76.7179],
  "chandigarh": [30.7333, 76.7794],
  "delhi": [28.6139, 77.2090],
  "new delhi": [28.6139, 77.2090],
  "shimla": [31.1048, 77.1734],
  "mumbai": [19.0760, 72.8777],
  "bangalore": [12.9716, 77.5946],
  "bengaluru": [12.9716, 77.5946],
  "london": [51.5074, -0.1278],
  "new york": [40.7128, -74.0060],
  "paris": [48.8566, 2.3522],
  "tokyo": [35.6762, 139.6503],
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('query')?.trim();

    if (!query) {
      return NextResponse.json({ error: "Query parameter required" }, { status: 400 });
    }

    const lowerQuery = query.toLowerCase();
    for (const [key, coords] of Object.entries(KNOWN_COORDS)) {
      if (lowerQuery === key || lowerQuery.includes(key)) {
        return NextResponse.json({
          lat: coords[0],
          lon: coords[1],
          displayName: query,
        });
      }
    }

    // Call Nominatim with compliant User-Agent header (required by OSM terms)
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
      {
        headers: {
          'User-Agent': 'UltronVoiceAssistant/1.0 (local-desktop-jarvis)',
          'Accept': 'application/json',
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        return NextResponse.json({
          lat: parseFloat(data[0].lat),
          lon: parseFloat(data[0].lon),
          displayName: data[0].display_name || query,
        });
      }
    }

    // Fallback if not found: default to Mohali baseline
    return NextResponse.json({
      lat: 30.7046,
      lon: 76.7179,
      displayName: query,
    });
  } catch (err: any) {
    console.error("Geocode error:", err);
    // Even on error, return Mohali baseline coordinates so UI never crashes
    return NextResponse.json({
      lat: 30.7046,
      lon: 76.7179,
      displayName: "Mohali, Punjab",
    });
  }
}

