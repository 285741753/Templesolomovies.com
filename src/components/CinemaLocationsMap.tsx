import { useCallback, useEffect, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { MapPin, Navigation, Search, Star } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

interface CinemaPlaceResult {
  id: string;
  name: string;
  address: string;
  location: { lat: number; lng: number };
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
}

const CITY_PRESETS = [
  { label: 'Los Angeles', query: 'historic movie theaters in Los Angeles' },
  { label: 'New York', query: 'independent cinema theaters in New York' },
  { label: 'London', query: 'arthouse cinemas in London' },
  { label: 'Paris', query: 'classic movie theaters in Paris' },
  { label: 'Tokyo', query: 'IMAX movie theaters in Tokyo' },
];

function CinemaMarker({
  place,
  selected,
  onSelect,
  onClose,
}: {
  place: CinemaPlaceResult;
  selected: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const [markerRef, marker] = useAdvancedMarkerRef();

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={place.location}
        title={place.name}
        onClick={onSelect}
      >
        <Pin
          background={selected ? '#E5A93B' : '#18181B'}
          borderColor="#E5A93B"
          glyphColor={selected ? '#09090B' : '#E5A93B'}
        />
      </AdvancedMarker>

      {selected && marker && (
        <InfoWindow anchor={marker} maxWidth={260} onCloseClick={onClose}>
          <div className="p-1 text-[#09090B]">
            <p className="font-semibold text-sm leading-snug">{place.name}</p>
            {place.address && (
              <p className="text-xs text-zinc-600 mt-1">{place.address}</p>
            )}
            {typeof place.rating === 'number' && (
              <p className="text-xs font-medium text-amber-700 mt-1.5">
                ★ {place.rating.toFixed(1)}
                {typeof place.userRatingCount === 'number'
                  ? ` (${place.userRatingCount.toLocaleString()})`
                  : ''}
              </p>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
}

function PlacesFinderInner() {
  const map = useMap();
  const coreLib = useMapsLibrary('core');
  const placesLib = useMapsLibrary('places');

  const [query, setQuery] = useState(CITY_PRESETS[0].query);
  const [places, setPlaces] = useState<CinemaPlaceResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const runSearch = useCallback(
    async (textQuery: string, bias?: { lat: number; lng: number }) => {
      if (!placesLib || !textQuery.trim()) return;
      setLoading(true);
      setErrorMsg(null);

      try {
        const response = await placesLib.Place.searchByText({
          textQuery: textQuery.trim(),
          fields: [
            'id',
            'displayName',
            'formattedAddress',
            'location',
            'rating',
            'userRatingCount',
            'businessStatus',
          ],
          maxResultCount: 8,
          ...(bias ? { locationBias: bias } : {}),
        });
        const found: CinemaPlaceResult[] = [];

        for (const p of response?.places ?? []) {
          if (!p.location) continue;
          const lat = typeof p.location.lat === 'function' ? p.location.lat() : Number(p.location.lat);
          const lng = typeof p.location.lng === 'function' ? p.location.lng() : Number(p.location.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

          found.push({
            id: p.id,
            name: p.displayName || 'Cinema Venue',
            address: p.formattedAddress || '',
            location: { lat, lng },
            rating: typeof p.rating === 'number' ? p.rating : undefined,
            userRatingCount:
              typeof p.userRatingCount === 'number' ? p.userRatingCount : undefined,
            businessStatus: p.businessStatus ? String(p.businessStatus) : undefined,
          });
        }

        setPlaces(found);
        if (found.length > 0 && map && coreLib) {
          setSelectedId(found[0].id);
          const bounds = new coreLib.LatLngBounds();
          for (const item of found) {
            bounds.extend(item.location);
          }
          map.fitBounds(bounds, 48);
        } else {
          setSelectedId(found[0]?.id ?? null);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('OVER_QUERY_LIMIT') ||
          msg.includes('429')
        ) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        setErrorMsg('Unable to search theaters right now. Please try another query.');
      } finally {
        setLoading(false);
      }
    },
    [placesLib, map]
  );

  useEffect(() => {
    if (placesLib && map && !initialized) {
      setInitialized(true);
      void runSearch(CITY_PRESETS[0].query);
    }
  }, [placesLib, map, initialized, runSearch]);

  const handleNearMe = () => {
    if (!navigator.geolocation) {
      setErrorMsg('Geolocation is not supported by your browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setQuery('movie theaters');
        void runSearch('movie theaters', coords);
      },
      () => {
        setErrorMsg('Location access was denied. Try searching by city instead.');
      }
    );
  };

  const selectedPlace = places.find((p) => p.id === selectedId) || null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12">
      {/* Left Sidebar: Search + Real Google Places Results */}
      <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-[#27272A] p-4 flex flex-col gap-3 max-h-[500px]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch(query);
          }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#71717A]"
              aria-hidden="true"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search theaters or cinema hubs..."
              className="w-full rounded-lg border border-[#27272A] bg-[#09090B] py-2 pl-9 pr-3 text-xs text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !placesLib}
            className="rounded-lg bg-[#E5A93B] px-3 py-2 text-xs font-semibold text-[#09090B] hover:bg-[#F0B84F] disabled:opacity-40 whitespace-nowrap cursor-pointer"
          >
            {loading ? '...' : 'Find'}
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-1.5">
          {CITY_PRESETS.map((city) => (
            <button
              key={city.label}
              type="button"
              onClick={() => {
                setQuery(city.query);
                void runSearch(city.query);
              }}
              className="rounded-md border border-[#27272A] bg-[#18181B] px-2.5 py-1 text-[11px] font-medium text-[#D4D4D8] hover:border-[#E5A93B]/60 hover:text-[#FAFAFA] cursor-pointer"
            >
              {city.label}
            </button>
          ))}
          <button
            type="button"
            onClick={handleNearMe}
            className="inline-flex items-center gap-1 rounded-md border border-[#E5A93B]/40 bg-[#E5A93B]/10 px-2.5 py-1 text-[11px] font-medium text-[#E5A93B] hover:bg-[#E5A93B]/20 cursor-pointer"
          >
            <Navigation className="h-3 w-3" aria-hidden="true" />
            <span>Near Me</span>
          </button>
        </div>

        {errorMsg && (
          <p role="alert" className="text-xs text-red-400">
            {errorMsg}
          </p>
        )}

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {places.length === 0 && !loading ? (
            <p className="text-xs text-[#71717A] py-6 text-center">
              Search a city or click a preset to explore live cinema venues on Google Maps.
            </p>
          ) : (
            places.map((p) => {
              const active = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(p.id);
                    if (map) {
                      map.panTo(p.location);
                      map.setZoom(14);
                    }
                  }}
                  className={`w-full text-left rounded-lg border p-3 transition-colors cursor-pointer ${
                    active
                      ? 'border-[#E5A93B] bg-[#18181B]'
                      : 'border-[#27272A] bg-[#09090B] hover:border-[#3F3F46]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-[#FAFAFA] leading-snug">{p.name}</p>
                    {typeof p.rating === 'number' && (
                      <span className="inline-flex items-center gap-0.5 text-[11px] font-mono tabular-nums text-[#E5A93B] shrink-0">
                        <Star className="h-3 w-3 fill-[#E5A93B]" aria-hidden="true" />
                        {p.rating.toFixed(1)}
                      </span>
                    )}
                  </div>
                  {p.address && (
                    <p className="text-[11px] text-[#71717A] mt-1 line-clamp-2">{p.address}</p>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Canvas: Google Map with explicit CSS height (CF2) */}
      <div className="lg:col-span-8 h-[440px] lg:h-[500px] w-full relative">
        <GoogleMap
          mapId="DEMO_MAP_ID"
          defaultCenter={{ lat: 34.0522, lng: -118.2437 }}
          defaultZoom={11}
          gestureHandling="greedy"
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          style={{ width: '100%', height: '100%' }}
        >
          {places.map((p) => (
            <CinemaMarker
              key={p.id}
              place={p}
              selected={selectedPlace?.id === p.id}
              onSelect={() => setSelectedId(p.id)}
              onClose={() => setSelectedId(null)}
            />
          ))}
        </GoogleMap>
      </div>
    </div>
  );
}

export function CinemaLocationsMap() {
  const { t } = useLanguage();
  const [apiKey, setApiKey] = useState<string>(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  );
  const [keyChecked, setKeyChecked] = useState(
    Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY)
  );

  useEffect(() => {
    if (apiKey) return;
    let active = true;
    fetch('/api/maps-config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { apiKey?: string } | null) => {
        if (active && data?.apiKey) {
          setApiKey(data.apiKey);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setKeyChecked(true);
      });
    return () => {
      active = false;
    };
  }, [apiKey]);

  return (
    <section
      id="cinema-map"
      aria-label={t('mapTitle')}
      className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 pb-10"
    >
      <div className="rounded-xl border border-[#27272A] bg-[#111114] overflow-hidden">
        <div className="border-b border-[#27272A] px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-wider text-[#E5A93B]">
              {t('mapEyebrow')}
            </p>
            <h2 className="font-display text-xl font-bold text-[#FAFAFA] flex items-center gap-2">
              <MapPin className="h-5 w-5 text-[#E5A93B]" aria-hidden="true" />
              <span>{t('mapTitle')}</span>
            </h2>
            <p className="text-xs text-[#A1A1AA] mt-0.5">{t('mapSubtitle')}</p>
          </div>
        </div>

        {apiKey ? (
          <APIProvider apiKey={apiKey} libraries={['places', 'marker']}>
            <PlacesFinderInner />
          </APIProvider>
        ) : keyChecked ? (
          <div className="h-[360px] flex flex-col items-center justify-center p-6 text-center text-sm text-[#A1A1AA]">
            <MapPin className="h-8 w-8 text-[#E5A93B] mb-2" aria-hidden="true" />
            <p className="font-semibold text-[#FAFAFA]">Google Maps API Key Required</p>
            <p className="text-xs text-[#71717A] max-w-md mt-1">
              Enable Google Maps in the AI Studio Maps Settings panel or restart the server once provisioned so theater search renders here.
            </p>
          </div>
        ) : (
          <div className="h-[440px] flex items-center justify-center text-xs text-[#71717A]">
            Loading Google Maps theater explorer...
          </div>
        )}
      </div>
    </section>
  );
}
