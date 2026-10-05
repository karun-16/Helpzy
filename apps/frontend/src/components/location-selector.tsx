import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import {
  districtHeadquarters,
  majorMarketplaceLocations,
  marketplaceCities,
  marketplaceDistricts,
  marketplaceStates,
  searchMarketplaceLocations,
  type MarketplaceLocation,
} from '@helpzy/config';

import { Caret, LocationPin, SearchGlyph } from '@/components/location-icons';
import { Popover, PopoverHeader } from '@/components/popover';
import {
  useLocationDetection,
  useMarketplaceLocation,
  type LocationDetectionState,
} from '@/lib/hooks';
import { toPublicLocation, writeMarketplaceLocation } from '@/lib/location-session';

/**
 * The marketplace location control in the app header.
 *
 * One searchable field answers for three different kinds of place, and the picker
 * is explicit about which is which, because they are not interchangeable:
 *
 *  - a **city** is what the marketplace filters on, and is the only thing that can
 *    be selected;
 *  - a **district** is a container, so selecting one opens it rather than
 *    pretending the district is somewhere you can browse;
 *  - an **assembly constituency** is an electoral area spanning many places, so it
 *    is shown for reference and opens its district instead of becoming a location.
 *
 * Device detection is offered first because it is the shortest path, but it is a
 * convenience and never a gate: a customer who declines permission, or whose
 * detection fails, can still pick a place by hand.
 */
export function LocationSelector() {
  const selection = useMarketplaceLocation();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const { state: detecting, detect: onDetect } = useLocationDetection();

  const state = marketplaceStates()[0];
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const trimmedQuery = query.trim();
  const searching = trimmedQuery.length > 0;

  const choose = useCallback((location: MarketplaceLocation) => {
    writeMarketplaceLocation(toPublicLocation(location), 'manual');
    setOpen(false);
    setQuery('');
    setExpanded(null);
  }, []);

  const districts = useMemo(() => marketplaceDistricts(state?.code ?? ''), [state?.code]);
  const popular = useMemo(() => majorMarketplaceLocations(), []);
  const results = useMemo(
    () => (searching ? searchMarketplaceLocations(trimmedQuery, 24) : []),
    [searching, trimmedQuery],
  );

  const detectionMessage = detectionNotice(detecting);

  const accent = 'rgb(23 67 178)';

  return (
    <>
      <Pressable
        ref={anchorRef}
        accessibilityRole="button"
        accessibilityLabel={
          selection
            ? `Marketplace location: ${selection.location.city}. Change location`
            : 'Choose your location'
        }
        onPress={() => setOpen((current) => !current)}
        className="min-h-9 flex-row items-center gap-1.5 rounded-lg px-2 active:bg-surface-muted dark:active:bg-slate-700"
      >
        <LocationPin size={13} color={accent} />
        <Text className="max-w-[8rem] text-sm font-semibold text-primary" numberOfLines={1}>
          {selection ? selection.location.city : 'Select location'}
        </Text>
        <Caret size={10} color={accent} open={open} />
      </Pressable>

      <Popover
        visible={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        width={360}
        maxHeight={520}
        label="Select your location"
      >
        <PopoverHeader title="Choose your location" onClose={() => setOpen(false)} />

        {/*
          The search field is always mounted. It used to live inside the results
          branch, where nothing outside it could set the query - so the field the
          picker invites a customer to type into could never be typed into.
        */}
        <View className="mb-3 flex-row items-center gap-2 rounded-lg border border-hairline-strong bg-surface px-3 py-2">
          <SearchGlyph size={14} color="rgb(120 130 145)" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search city, district or area..."
            placeholderTextColor="rgb(140 150 165)"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search city, district or area"
            className="min-h-6 flex-1 text-sm text-primary"
          />
          {query.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery('')}
              className="min-h-6 min-w-6 items-center justify-center"
            >
              <Text className="text-sm text-muted">×</Text>
            </Pressable>
          ) : null}
        </View>

        {searching ? (
          <SearchResults
            results={results}
            query={trimmedQuery}
            selectedSlug={selection?.location.slug ?? null}
            onChoose={choose}
            onOpenDistrict={(name) => {
              setQuery('');
              setExpanded(name);
            }}
          />
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 400 }}>
            {/*
              Detection sits directly under the search field because it is the
              shortest path to a location, and the copy says plainly that declining
              is fine - an unexplained permission prompt is the most common reason
              people give up on a marketplace.
            */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Use my current location"
              onPress={onDetect}
              disabled={detecting === 'detecting'}
              className="mb-1 flex-row items-center gap-2.5 rounded-lg border border-hairline bg-surface-muted px-3 py-2.5 active:opacity-80 dark:bg-slate-700"
            >
              {detecting === 'detecting' ? (
                <ActivityIndicator size="small" color={accent} />
              ) : (
                <LocationPin size={14} color={accent} />
              )}
              <Text className="flex-1 text-sm font-semibold text-primary">
                {detecting === 'detecting' ? 'Finding your location...' : 'Use my current location'}
              </Text>
            </Pressable>

            {detectionMessage ? (
              <Text className="mb-2 px-1 text-xs text-secondary">{detectionMessage}</Text>
            ) : null}

            {/*
              Popular is scoped to the states HELPZY actually serves. Labelling it
              matters: an unlabelled shortlist implies nationwide coverage the
              marketplace does not have.
            */}
            <Text className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">
              Popular cities
            </Text>
            <Text className="mb-2 text-xs text-muted">Major cities in {state?.name ?? 'AP'}</Text>
            <View className="mb-4 flex-row flex-wrap gap-1.5">
              {popular.map((location) => (
                <Pressable
                  key={location.slug}
                  accessibilityRole="button"
                  onPress={() => choose(location)}
                  className={`rounded-md border px-2.5 py-1.5 active:opacity-80 ${
                    selection?.location.slug === location.slug
                      ? 'border-action bg-action-soft'
                      : 'border-hairline-strong bg-surface'
                  }`}
                >
                  <Text className="text-xs font-semibold text-primary">{location.city}</Text>
                </Pressable>
              ))}
            </View>

            <Text className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">
              {state?.name ?? 'Districts'}
            </Text>

            {/* One row per district, alphabetical, expanded on demand. */}
            {districts.map((district) => {
              const isOpen = expanded === district;
              const headquarters = districtHeadquarters(state?.code ?? '', district);
              const places = isOpen ? marketplaceCities(state?.code ?? '', district) : [];

              return (
                <View key={district}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isOpen }}
                    accessibilityLabel={`${district} district`}
                    onPress={() => setExpanded(isOpen ? null : district)}
                    className="flex-row items-center gap-2 border-b border-hairline py-2.5 active:opacity-70"
                  >
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-primary">{district}</Text>
                      {headquarters ? (
                        <Text className="text-xs text-muted">Headquarters: {headquarters}</Text>
                      ) : null}
                    </View>
                    <Text className="text-xs text-muted">{places.length || ''}</Text>
                    <Caret size={12} color="rgb(120 130 145)" open={isOpen} />
                  </Pressable>

                  {isOpen ? (
                    <View className="border-b border-hairline pb-1">
                      {places.length === 0 ? (
                        <Text className="py-2 text-xs text-secondary">
                          No places listed for {district} yet.
                        </Text>
                      ) : (
                        places.map((location) => (
                          <Pressable
                            key={location.slug}
                            accessibilityRole="button"
                            accessibilityState={{
                              selected: selection?.location.slug === location.slug,
                            }}
                            onPress={() => choose(location)}
                            className="flex-row items-center justify-between border-b border-hairline py-2 pl-3 pr-1 active:bg-surface-muted dark:active:bg-slate-700"
                          >
                            <Text className="text-sm text-primary">{location.city}</Text>
                            {selection?.location.slug === location.slug ? (
                              <Text className="text-xs font-semibold text-action-text">
                                Selected
                              </Text>
                            ) : null}
                          </Pressable>
                        ))
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        )}
      </Popover>
    </>
  );
}

/**
 * Search results, grouped by what the customer actually matched.
 *
 * The three kinds are visually distinct and labelled, because picking a
 * constituency row expecting a city is the mistake this structure exists to
 * prevent.
 */
function SearchResults({
  results,
  query,
  selectedSlug,
  onChoose,
  onOpenDistrict,
}: {
  results: ReturnType<typeof searchMarketplaceLocations>;
  query: string;
  selectedSlug: string | null;
  onChoose: (location: MarketplaceLocation) => void;
  onOpenDistrict: (district: string) => void;
}) {
  if (results.length === 0) {
    return (
      <Text className="py-6 text-center text-sm text-secondary">
        No city, district or constituency called "{query}". Try a nearby name.
      </Text>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 400 }}>
      {results.map((result) => {
        if (result.type === 'city') {
          return (
            <Pressable
              key={result.location.slug}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedSlug === result.location.slug }}
              onPress={() => onChoose(result.location)}
              className="border-b border-hairline px-1 py-2.5 active:bg-surface-muted dark:active:bg-slate-700"
            >
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 text-sm font-semibold text-primary">
                  {result.location.city}
                </Text>
                <TypeTag label="City" />
                {selectedSlug === result.location.slug ? (
                  <Text className="text-xs font-semibold text-action-text">Selected</Text>
                ) : null}
              </View>
              <Text className="text-xs text-muted">
                {result.location.district} district, {result.location.state}
              </Text>
            </Pressable>
          );
        }

        if (result.type === 'district') {
          return (
            <Pressable
              key={`district-${result.district}`}
              accessibilityRole="button"
              onPress={() => onOpenDistrict(result.district)}
              className="flex-row items-center gap-2 border-b border-hairline px-1 py-2.5 active:bg-surface-muted dark:active:bg-slate-700"
            >
              <View className="flex-1">
                <Text className="text-sm font-semibold text-primary">{result.district}</Text>
                <Text className="text-xs text-muted">
                  {result.headquarters ? `Headquarters: ${result.headquarters} · ` : ''}
                  {result.cityCount} {result.cityCount === 1 ? 'place' : 'places'}
                </Text>
              </View>
              <TypeTag label="District" />
            </Pressable>
          );
        }

        const { constituency } = result;
        return (
          <Pressable
            key={`ac-${constituency.number}`}
            accessibilityRole="button"
            onPress={() => onOpenDistrict(constituency.district)}
            className="flex-row items-center gap-2 border-b border-hairline px-1 py-2.5 active:bg-surface-muted dark:active:bg-slate-700"
          >
            <View className="flex-1">
              <Text className="text-sm font-semibold text-primary">
                {constituency.number} - {constituency.name}
              </Text>
              <Text className="text-xs text-muted">
                Assembly constituency, {constituency.district} district
              </Text>
            </View>
            {constituency.reservation !== 'NONE' ? (
              <TypeTag label={constituency.reservation} />
            ) : null}
            <TypeTag label="Constituency" />
          </Pressable>
        );
      })}

      {/* A constituency is not a place you can browse, so the route out of one is
          spelled out rather than left for the customer to infer. */}
      <Text className="px-1 py-3 text-xs text-muted">
        A constituency covers many places. Choosing one opens its district so you can pick a city.
      </Text>
    </ScrollView>
  );
}

/** The badge that tells the three kinds of result apart at a glance. */
function TypeTag({ label }: { label: string }) {
  return (
    <View className="rounded border border-hairline-strong px-1.5 py-0.5">
      <Text className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</Text>
    </View>
  );
}

/**
 * Detection failures are explained, never swallowed.
 *
 * The distinction that matters to the customer is "you said no" versus "we could
 * not work it out": the first needs no retry, the second might work if they move
 * or if the browser is fussy. Either way the picker stays usable.
 */
function detectionNotice(outcome: LocationDetectionState): string | null {
  switch (outcome) {
    case 'denied':
      return 'Location permission denied. Choose your city below.';
    case 'unavailable':
      return 'This browser cannot share your location. Choose your city below.';
    case 'failed':
      return 'We could not determine your location. Choose your city below.';
    default:
      return null;
  }
}
