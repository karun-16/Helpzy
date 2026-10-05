import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import {
  MARKETPLACE_LOCATIONS,
  findMarketplaceLocation,
  marketplaceCities,
  marketplaceDistricts,
  marketplaceStates,
  type MarketplaceLocation as DatasetLocation,
} from '@helpzy/config';

import { LabelledInput } from '@/components/marketplace-ui';

/**
 * Cascading State -> District -> City picker for a professional's service area.
 *
 * Shared by registration and the profile screen so the two cannot offer different
 * places, and so the cascading rule - a city is only ever offered from its own
 * district - is written once.
 *
 * The value crossing the boundary is the location **slug**, never the typed names.
 * That is what keeps "Tirupati" from becoming a second, different place, and it is
 * also exactly what the API validates.
 */
export function MarketplaceLocationField({
  value,
  onChange,
  label = 'Service location',
  hint,
}: {
  /** Currently selected slug, or null when nothing is chosen. */
  value: string | null;
  onChange: (slug: string | null) => void;
  label?: string;
  hint?: string;
}) {
  const selected = value ? findMarketplaceLocation(value) : undefined;

  // Seeded from the current value so a professional editing their profile sees
  // the place they already picked, not an empty form.
  const [stateCode, setStateCode] = useState<string>(
    selected?.stateCode ?? marketplaceStates()[0]?.code ?? '',
  );
  const [district, setDistrict] = useState<string>(selected?.district ?? '');
  const [search, setSearch] = useState('');

  const districts = useMemo(() => marketplaceDistricts(stateCode), [stateCode]);
  const cities = useMemo(
    () => (district ? marketplaceCities(stateCode, district) : []),
    [stateCode, district],
  );

  /*
   * Search spans the whole dataset rather than the chosen district, so a
   * professional who knows the city they want is not forced through the district
   * step first. Each row carries its own district, so the result is unambiguous.
   */
  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];

    return MARKETPLACE_LOCATIONS.filter(
      (location) =>
        location.city.toLowerCase().includes(query) ||
        location.district.toLowerCase().includes(query),
    ).slice(0, 30);
  }, [search]);

  return (
    <View className="gap-2">
      <Text className="text-sm font-semibold text-primary">{label}</Text>
      {hint ? <Text className="text-xs text-secondary">{hint}</Text> : null}

      {selected ? (
        <View className="rounded-lg border border-hairline-strong bg-surface-muted px-3 py-2.5">
          <Text className="text-sm font-semibold text-primary">
            {selected.city}, {selected.district}
          </Text>
          <Text className="text-xs text-secondary">{selected.state}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear service location"
            onPress={() => {
              onChange(null);
              setDistrict('');
              setSearch('');
            }}
            className="mt-2 min-h-9 self-start justify-center"
          >
            <Text className="text-sm font-semibold text-action-text">Change location</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <LabelledInput
            label="Search city"
            value={search}
            onChangeText={setSearch}
            placeholder="Tirupati, Vijayawada…"
            autoCapitalize="none"
          />

          {search.trim() ? (
            matches.length === 0 ? (
              <Text className="text-xs text-secondary">
                No place called “{search.trim()}”. Try a nearby city or district.
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 160 }}>
                {matches.map((location) => (
                  <LocationChoice
                    key={location.slug}
                    location={location}
                    onPress={() => {
                      onChange(location.slug);
                      setSearch('');
                    }}
                  />
                ))}
              </ScrollView>
            )
          ) : (
            <>
              <DistrictRow
                stateCode={stateCode}
                districts={districts}
                selected={district}
                onSelect={setDistrict}
              />
              {district ? (
                cities.length === 0 ? (
                  <Text className="text-xs text-secondary">
                    No cities listed for {district} yet.
                  </Text>
                ) : (
                  <ScrollView style={{ maxHeight: 160 }}>
                    {cities.map((location) => (
                      <LocationChoice
                        key={location.slug}
                        location={location}
                        onPress={() => onChange(location.slug)}
                      />
                    ))}
                  </ScrollView>
                )
              ) : (
                <Text className="text-xs text-secondary">
                  Pick a district to see the cities inside it.
                </Text>
              )}
            </>
          )}

          {marketplaceStates().length > 1 ? (
            <View className="flex-row flex-wrap gap-2">
              {marketplaceStates().map((state) => (
                <Pressable
                  key={state.code}
                  accessibilityRole="button"
                  onPress={() => {
                    setStateCode(state.code);
                    setDistrict('');
                  }}
                  className={`min-h-9 rounded-full border px-3 py-1.5 active:opacity-80 ${
                    stateCode === state.code
                      ? 'border-action bg-action-soft'
                      : 'border-hairline-strong bg-surface'
                  }`}
                >
                  <Text className="text-xs font-semibold text-primary">{state.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function DistrictRow({
  stateCode,
  districts,
  selected,
  onSelect,
}: {
  stateCode: string;
  districts: string[];
  selected: string;
  onSelect: (name: string) => void;
}) {
  if (districts.length === 0) {
    return <Text className="text-xs text-secondary">No districts configured.</Text>;
  }

  return (
    <>
      <Text className="text-xs font-bold uppercase tracking-wide text-muted">
        District in {marketplaceStates().find((s) => s.code === stateCode)?.name}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row gap-2">
          {districts.map((name) => (
            <Pressable
              key={name}
              accessibilityRole="button"
              onPress={() => onSelect(name)}
              className={`min-h-9 rounded-full border px-3 py-1.5 active:opacity-80 ${
                selected === name
                  ? 'border-action bg-action-soft'
                  : 'border-hairline-strong bg-surface'
              }`}
            >
              <Text className="text-xs font-semibold text-primary">{name}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

function LocationChoice({ location, onPress }: { location: DatasetLocation; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="border-b border-hairline py-2.5 active:bg-surface-muted dark:active:bg-slate-700"
    >
      <Text className="text-sm font-semibold text-primary">{location.city}</Text>
      <Text className="text-xs text-muted">
        {location.district} district · {location.state}
      </Text>
    </Pressable>
  );
}
