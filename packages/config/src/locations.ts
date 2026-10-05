/**
 * Marketplace location dataset - the single source of truth for where HELPZY
 * trades.
 *
 * This file is the ONLY place a place name is written down. The frontend selector
 * renders it, the backend validates a submitted location against it, and the
 * location seed writes it into PostgreSQL. Because all three read the same array,
 * a city can never appear in the picker while being rejected by the API.
 *
 * Identity
 * --------
 * A marketplace location is the triple (state, district, city) addressed by a
 * derived slug. Two rules keep that stable:
 *
 *  1. Every district carries an explicit `slug`, so identity does not depend on
 *     its display name. Andhra Pradesh renamed three districts after this dataset
 *     was first written - `Anantapur` to `Ananthapuramu`, `Konaseema` to
 *     `Dr. B. R. Ambedkar Konaseema`, and `SPSR Nellore` to
 *     `Sri Potti Sriramulu Nellore` - and the slugs did not change, so no stored
 *     `professional_profiles.locationId` was invalidated by a rename.
 *  2. Free-text filtering is deliberately avoided: "Tirupati", "tirupati" and
 *     "TIRUPATI" are one place here, and one row in `locations`.
 *
 * Administrative structure
 * ------------------------
 * The districts are the 28 in force since 31 December 2025, when the State
 * Government created Polavaram and Markapuram, taking the count from 26.
 * `Anakapalli` is also present; it had been missing from the previous revision of
 * this file.
 *
 * A place is NOT the same thing as an assembly constituency. A constituency is an
 * electoral area that routinely spans a district and many towns, so it is held in
 * its own list (`ASSEMBLY_CONSTITUENCIES`) and never in `MARKETPLACE_LOCATIONS`.
 * Only cities become marketplace locations, which is what keeps the backend's
 * city-based filter honest. See `searchMarketplaceLocations` for how a
 * constituency search result is surfaced.
 *
 * Coverage
 * --------
 * HELPZY currently trades in Andhra Pradesh only. `POPULAR_CITY_SLUGS` is a
 * curated shortlist of genuinely well-known cities *within that state*, and the
 * picker labels the section accordingly, so nothing here implies a national
 * footprint. Extending coverage is a matter of adding states: every helper below
 * is already multi-state.
 *
 * Coordinates
 * -----------
 * `latitude` / `longitude` are approximate city centroids, used for exactly one
 * thing: turning a device's GPS fix into the nearest supported city so the
 * customer does not have to type it. They are never stored for a customer, never
 * sent to the API, and never used to rank or measure anything.
 */

/** `[name, latitude, longitude, major]` — `major` is the curated popular shortlist. */
type CitySeed = readonly [name: string, latitude: number, longitude: number, major: boolean];

interface MarketplaceDistrictSeed {
  /**
   * Stable identity, deliberately decoupled from `name`.
   *
   * Renaming a district must not orphan the locations underneath it, so the slug
   * is declared here rather than derived from the display name.
   */
  slug: string;
  /** Official district name, shown to customers. */
  name: string;
  /** Administrative headquarters, shown as context in search results. */
  headquarters: string;
  /** Notable cities and towns. Insertion order is display order. */
  cities: readonly CitySeed[];
}

interface MarketplaceStateSeed {
  /** ISO 3166-2 style subdivision code. */
  code: string;
  name: string;
  districts: readonly MarketplaceDistrictSeed[];
}

export interface MarketplaceLocation {
  /** Derived stable key: `ap-tirupati-tirupati`. This is what the API accepts. */
  slug: string;
  stateCode: string;
  state: string;
  district: string;
  districtSlug: string;
  city: string;
  citySlug: string;
  latitude: number;
  longitude: number;
  /** A well-known city, surfaced in the curated popular shortlist. */
  major: boolean;
  /** Position within the dataset, so ordering is explicit rather than accidental. */
  sortOrder: number;
}

/**
 * The 28 districts of Andhra Pradesh, alphabetical, in force since 31 Dec 2025.
 *
 * Where the 2025 reorganisation moved a town between districts - Markapuram and
 * Kanigiri to the new Markapuram district, Rampachodavaram to the new Polavaram
 * district, Hindupur and Dharmavaram to Sri Sathya Sai - the town is filed under
 * its current district rather than its old one.
 */
const ANDHRA_PRADESH: MarketplaceStateSeed = {
  code: 'AP',
  name: 'Andhra Pradesh',
  districts: [
    {
      slug: 'alluri-sitharama-raju',
      name: 'Alluri Sitharama Raju',
      headquarters: 'Paderu',
      cities: [
        ['Araku', 18.33, 82.88, true],
        ['Paderu', 18.02, 82.92, true],
        ['Chintapalli', 18.1, 82.7, false],
        ['Veerabhimlavaram', 18.2, 82.8, false],
        ['Munta', 18.28, 82.85, false],
      ],
    },
    {
      slug: 'anakapalli',
      name: 'Anakapalli',
      headquarters: 'Anakapalli',
      cities: [
        ['Anakapalli', 17.69, 83.36, false],
        ['Chodavaram', 17.61, 83.06, false],
        ['Madugula', 17.75, 83.42, false],
        ['Narsipatnam', 17.67, 83.55, false],
        ['Payakaraopet', 17.44, 83.44, false],
        ['Pendurthi', 17.71, 83.2, false],
        ['Elamanchili', 17.61, 83.29, false],
      ],
    },
    {
      slug: 'anantapur',
      name: 'Ananthapuramu',
      headquarters: 'Anantapuram',
      cities: [
        ['Anantapur', 14.68, 77.6, true],
        ['Anantapur Urban', 14.69, 77.61, false],
        ['Uravakonda', 14.73, 77.55, false],
        ['Guntakal', 14.87, 77.37, false],
        ['Tadipatri', 14.91, 77.61, false],
        ['Kalyandurg', 14.95, 77.15, false],
        ['Raptadu', 14.95, 77.75, false],
        ['Rayadurg', 14.75, 76.92, false],
        ['Singanamala', 14.92, 77.28, false],
      ],
    },
    {
      slug: 'annamayya',
      name: 'Annamayya',
      headquarters: 'Madanapalle',
      cities: [
        ['Madanapalle', 13.66, 78.52, true],
        ['Rayachoti', 14.22, 78.75, true],
        ['Jammalamadugu', 14.62, 78.92, true],
        ['Pileru', 14.22, 78.8, false],
        ['Punganur', 14.13, 78.83, false],
        ['Thamballapalle', 14.32, 79.02, false],
        ['Vempalli', 14.45, 78.95, false],
        ['Vontayaram', 14.4, 78.85, false],
      ],
    },
    {
      slug: 'bapatla',
      name: 'Bapatla',
      headquarters: 'Bapatla',
      cities: [
        ['Bapatla', 15.79, 80.45, true],
        ['Chirala', 15.66, 80.0, false],
        ['Parchur', 16.1, 80.45, false],
        ['Repalle', 16.3, 80.8, false],
        ['Vetapalem', 16.24, 80.8, false],
        ['Kakumanu', 16.55, 80.35, false],
        ['Sullurpalli', 16.3, 80.75, false],
        ['Bheemili', 16.45, 80.55, false],
      ],
    },
    {
      slug: 'chittoor',
      name: 'Chittoor',
      headquarters: 'Chittoor',
      cities: [
        ['Chittoor', 13.63, 78.7, true],
        ['Gangavalli', 13.45, 79.0, true],
        ['Palamaner', 13.19, 79.07, true],
        ['Kuppam', 12.91, 78.94, false],
        ['Puthalapattu', 13.35, 79.1, false],
        ['Madanandapuram', 13.5, 78.92, false],
        ['Nagari', 13.55, 79.55, false],
      ],
    },
    {
      slug: 'konaseema',
      name: 'Dr. B. R. Ambedkar Konaseema',
      headquarters: 'Amalapuram',
      cities: [
        ['Amalapuram', 16.58, 82.01, true],
        ['Ramachandrapuram', 16.8, 82.1, false],
        ['Mummidivaram', 16.97, 82.11, false],
        ['Razole', 16.75, 82.0, false],
        ['Kothapeta', 16.78, 82.13, false],
        ['Gannavaram', 16.85, 82.05, false],
        ['Morthalam', 16.82, 82.0, false],
        ['Ghantasala', 16.78, 82.05, false],
        ['Vakmandal', 16.9, 82.1, false],
      ],
    },
    {
      slug: 'east-godavari',
      name: 'East Godavari',
      headquarters: 'Rajamahendravaram',
      cities: [
        ['Rajahmundry', 17.0, 81.8, true],
        ['Anaparthy', 17.15, 81.95, false],
        ['Mandapeta', 17.05, 81.9, false],
        ['Rajanagaram', 17.18, 81.9, false],
        ['Kovvur', 17.07, 81.74, false],
        ['Nidadavole', 16.92, 81.75, false],
        ['Gopalapuram', 16.99, 81.79, false],
      ],
    },
    {
      slug: 'eluru',
      name: 'Eluru',
      headquarters: 'Eluru',
      cities: [
        ['Eluru', 16.71, 81.1, true],
        ['Chintalapudi', 17.01, 81.4, false],
        ['Nuzvid', 16.58, 80.85, false],
        ['Kaikalur', 16.88, 81.25, false],
        ['Denduluru', 16.83, 81.06, false],
        ['Unguturu', 16.8, 81.11, false],
        ['Akiveedu', 17.05, 81.35, false],
        ['Gudem', 17.78, 81.35, false],
      ],
    },
    {
      slug: 'guntur',
      name: 'Guntur',
      headquarters: 'Guntur',
      cities: [
        ['Guntur', 16.31, 80.44, true],
        ['Tenali', 16.24, 80.49, true],
        ['Mangalagiri', 16.79, 80.57, false],
        ['Ponnur', 16.57, 80.75, false],
        ['Tadikonda', 16.51, 80.5, false],
        ['Prathipadu', 16.75, 80.85, false],
      ],
    },
    {
      slug: 'kakinada',
      name: 'Kakinada',
      headquarters: 'Kakinada',
      cities: [
        ['Kakinada', 16.99, 82.25, true],
        ['Tuni', 17.36, 82.41, false],
        ['Pithapuram', 17.2, 82.25, false],
        ['Peddapuram', 16.9, 82.13, false],
        ['Jaggampeta', 17.02, 82.06, false],
        ['Samalkota', 17.0, 82.15, false],
        ['Prathipadu', 16.95, 82.2, false],
      ],
    },
    {
      slug: 'krishna',
      name: 'Krishna',
      headquarters: 'Machilipatnam',
      cities: [
        ['Machilipatnam', 16.19, 80.19, true],
        ['Gudivada', 16.83, 80.99, true],
        ['Pedana', 16.4, 80.85, false],
        ['Avanigadda', 16.03, 80.21, false],
        ['Pamarru', 16.5, 80.87, false],
        ['Penamaluru', 16.35, 80.9, false],
        ['Gannavaram', 16.58, 80.83, false],
      ],
    },
    {
      slug: 'kurnool',
      name: 'Kurnool',
      headquarters: 'Kurnool',
      cities: [
        ['Kurnool', 15.83, 78.04, true],
        ['Adoni', 15.63, 77.28, true],
        ['Alur', 15.68, 77.13, false],
        ['Yemmiganur', 15.73, 77.48, false],
        ['Mantralayam', 15.88, 77.7, false],
        ['Pattikonda', 15.82, 77.7, false],
        ['Kodumur', 15.83, 78.03, false],
      ],
    },
    {
      slug: 'markapuram',
      name: 'Markapuram',
      headquarters: 'Markapuram',
      cities: [
        ['Markapuram', 15.74, 78.2, false],
        ['Kanigiri', 15.45, 79.0, false],
        ['Giddalur', 15.78, 78.6, false],
        ['Yerragondapalem', 15.9, 79.55, false],
        ['Eragondapalem', 15.68, 78.95, false],
      ],
    },
    {
      slug: 'nandyal',
      name: 'Nandyal',
      headquarters: 'Nandyal',
      cities: [
        ['Nandyal', 15.48, 78.48, true],
        ['Banaganapalle', 15.33, 78.37, true],
        ['Srisailam', 15.19, 78.36, false],
        ['Allagadda', 15.55, 78.48, false],
        ['Nandikotkur', 15.45, 78.48, false],
        ['Panyam', 15.42, 78.4, false],
        ['Dhone', 15.18, 78.23, false],
      ],
    },
    {
      slug: 'ntr',
      name: 'NTR',
      headquarters: 'Vijayawada',
      cities: [
        ['Vijayawada', 16.51, 80.65, true],
        ['Nandigama', 16.48, 80.7, false],
        ['Tiruvuru', 16.65, 81.1, false],
        ['Mylavaram', 16.55, 80.9, false],
        ['Jaggayyapeta', 16.75, 80.9, false],
        ['Ganganapalli', 16.75, 80.94, false],
        ['Kanakolu', 16.9, 80.7, false],
        ['Movva', 16.55, 80.9, false],
      ],
    },
    {
      slug: 'palnadu',
      name: 'Palnadu',
      headquarters: 'Narasaraopeta',
      cities: [
        ['Narasaraopet', 16.07, 80.05, true],
        ['Sattenapalle', 16.13, 80.15, true],
        ['Chilakaluripet', 16.35, 80.13, false],
        ['Gurazala', 16.29, 80.12, false],
        ['Pedakakani', 16.32, 80.1, false],
        ['Rajupalem', 16.3, 80.03, false],
        ['Vinukonda', 16.3, 80.2, false],
        ['Macherla', 16.38, 80.13, false],
        ['Pedakurapadu', 16.3, 80.05, false],
      ],
    },
    {
      slug: 'parvathipuram-manyam',
      name: 'Parvathipuram Manyam',
      headquarters: 'Parvathipuram',
      cities: [
        ['Parvathipuram', 18.79, 83.43, true],
        ['Salur', 18.52, 83.2, true],
        ['Palakonda', 18.75, 83.45, false],
        ['Kurupam', 18.67, 83.4, false],
        ['Udayagiri', 18.62, 83.37, false],
        ['Makkur', 18.55, 83.28, false],
      ],
    },
    {
      slug: 'polavaram',
      name: 'Polavaram',
      headquarters: 'Rampachodavaram',
      cities: [
        ['Rampachodavaram', 17.25, 81.9, false],
        ['Polavaram', 17.25, 81.6, false],
        ['Chinturu', 17.67, 82.0, false],
        ['Gokavaram', 17.1, 81.9, false],
        ['Yeleswaram', 17.28, 81.75, false],
      ],
    },
    {
      slug: 'prakasam',
      name: 'Prakasam',
      headquarters: 'Ongole',
      cities: [
        ['Ongole', 15.51, 80.09, true],
        ['Chirala', 15.77, 80.0, false],
        ['Kandukur', 15.44, 79.99, false],
        ['Kondapi', 15.67, 79.98, false],
        ['Addanki', 15.61, 79.92, false],
        ['Darsi', 15.87, 80.02, false],
        ['Santhanuthalapadu', 15.97, 79.97, false],
      ],
    },
    {
      slug: 'spsr-nellore',
      name: 'Sri Potti Sriramulu Nellore',
      headquarters: 'Nellore',
      cities: [
        ['Nellore', 14.44, 79.99, true],
        ['Kavali', 14.91, 79.97, true],
        ['Atmakur', 15.03, 79.78, false],
        ['Kovur', 14.73, 79.98, false],
        ['Sarvepalli', 14.57, 79.87, false],
        ['Sullur', 14.5, 79.74, false],
        ['Udayagiri', 14.5, 79.55, false],
      ],
    },
    {
      slug: 'sri-sathya-sai',
      name: 'Sri Sathya Sai',
      headquarters: 'Puttaparthi',
      cities: [
        ['Puttaparthi', 14.0, 77.77, true],
        ['Penukonda', 14.07, 77.59, true],
        ['Hindupur', 15.37, 77.49, true],
        ['Dharmavaram', 14.41, 77.72, false],
        ['Kadiri', 14.51, 78.17, false],
        ['Madakasira', 14.05, 77.65, false],
        ['Bathalapalli', 14.0, 78.5, false],
      ],
    },
    {
      slug: 'srikakulam',
      name: 'Srikakulam',
      headquarters: 'Srikakulam',
      cities: [
        ['Srikakulam', 18.3, 83.9, true],
        ['Amudalavalasa', 18.03, 83.72, true],
        ['Palasa', 18.25, 84.1, false],
        ['Tekkali', 18.35, 84.25, false],
        ['Ichchapuram', 18.3, 84.13, false],
        ['Pathapatnam', 18.0, 83.85, false],
        ['Sompeta', 18.38, 84.16, false],
      ],
    },
    {
      slug: 'tirupati',
      name: 'Tirupati',
      headquarters: 'Tirupati',
      cities: [
        ['Tirupati', 13.63, 79.42, true],
        ['Srikalahasti', 13.76, 79.32, true],
        ['Chandragiri', 13.58, 79.35, false],
        ['Renigunta', 13.64, 79.4, false],
        ['Gudur', 14.07, 79.85, false],
        ['Puttur', 13.63, 79.6, false],
        ['Sullurpeta', 13.9, 79.3, false],
        ['Venkatagiri', 13.93, 79.49, false],
        ['Sarvepalli', 13.75, 79.25, false],
        ['Kodur', 13.83, 79.55, false],
        ['Sathyavedu', 14.02, 79.25, false],
      ],
    },
    {
      slug: 'visakhapatnam',
      name: 'Visakhapatnam',
      headquarters: 'Visakhapatnam',
      cities: [
        ['Visakhapatnam', 17.69, 83.22, true],
        ['Gajuwaka', 17.76, 83.17, true],
        ['Bheemunipatnam', 17.77, 83.38, false],
        ['Bhimili', 17.51, 83.03, false],
        ['Srungavarapukota', 18.0, 83.4, false],
      ],
    },
    {
      slug: 'vizianagaram',
      name: 'Vizianagaram',
      headquarters: 'Vizianagaram',
      cities: [
        ['Vizianagaram', 18.11, 83.4, true],
        ['Bobbili', 18.33, 83.37, true],
        ['Etcherla', 18.15, 83.45, false],
        ['Cheepurupalli', 18.22, 83.55, false],
        ['Gajapathi', 18.32, 83.75, false],
        ['Rajam', 18.25, 83.3, false],
        ['Nellimarla', 18.13, 83.4, false],
        ['Denupalli', 18.35, 83.5, false],
      ],
    },
    {
      slug: 'west-godavari',
      name: 'West Godavari',
      headquarters: 'Bhimavaram',
      cities: [
        ['Bhimavaram', 16.89, 81.51, true],
        ['Narsapur', 16.9, 81.69, false],
        ['Palakollu', 16.5, 81.73, false],
        ['Tadepalligudem', 16.9, 81.72, false],
        ['Tanuku', 16.98, 81.7, false],
        ['Undi', 16.9, 81.72, false],
        ['Yanam', 16.7, 82.2, false],
        ['Yelamanchili', 17.05, 81.72, false],
        ['Palakoderu', 16.92, 81.75, false],
        ['Ganapavaram', 16.5, 81.65, false],
        ['Achanta', 16.65, 81.75, false],
      ],
    },
    {
      slug: 'ysr-kadapa',
      name: 'YSR Kadapa',
      headquarters: 'Kadapa',
      cities: [
        ['Kadapa', 14.47, 78.82, true],
        ['Proddatur', 14.75, 78.55, false],
        ['Mydukur', 14.55, 78.67, false],
        ['Badvel', 14.68, 78.7, false],
        ['Rajampet', 14.02, 78.9, false],
        ['Jammalamadugu', 14.62, 78.92, false],
        ['Rayavaram', 14.68, 78.7, false],
      ],
    },
  ],
};

/** Every state HELPZY trades in. Adding a state means adding one entry here. */
const MARKETPLACE_STATES: readonly MarketplaceStateSeed[] = [ANDHRA_PRADESH];

/**
 * The curated popular shortlist.
 *
 * Keyed by slug so a rename cannot silently drop a city from the shortlist, and
 * declared in display order so the picker never has to sort it. These are the
 * well-known cities *of Andhra Pradesh* - the only state HELPZY currently serves.
 *
 * Deliberately short. An earlier revision marked 30 cities popular, which pushed
 * the district list below the fold so a customer had to scroll past a wall of
 * chips to reach the one place they actually wanted to browse. Twelve is enough
 * to cover the cities people look for by name; everything else is one search or
 * one district tap away.
 */
const POPULAR_CITY_SLUGS: readonly string[] = [
  'ap-ntr-vijayawada',
  'ap-visakhapatnam-visakhapatnam',
  'ap-tirupati-tirupati',
  'ap-guntur-guntur',
  'ap-east-godavari-rajahmundry',
  'ap-kakinada-kakinada',
  'ap-spsr-nellore-nellore',
  'ap-krishna-machilipatnam',
  'ap-konaseema-amalapuram',
  'ap-kurnool-kurnool',
  'ap-srikakulam-srikakulam',
  'ap-vizianagaram-vizianagaram',
];

/** Lower-case, ASCII, hyphen-separated. Keeps slugs URL-safe without a dependency. */
export function slugifyLocationName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Curated popular shortlist, in the declared order and skipping any slug the
 * dataset no longer contains.
 */
const POPULAR_SLUG_SET = new Set(POPULAR_CITY_SLUGS);

function buildLocations(): MarketplaceLocation[] {
  const locations: MarketplaceLocation[] = [];
  let sortOrder = 0;

  for (const state of MARKETPLACE_STATES) {
    for (const district of state.districts) {
      for (const [cityName, latitude, longitude] of district.cities) {
        const citySlug = slugifyLocationName(cityName);
        const slug = `${state.code.toLowerCase()}-${district.slug}-${citySlug}`;
        locations.push({
          slug,
          stateCode: state.code,
          state: state.name,
          // Official district name, so a rename reaches the customer immediately.
          district: district.name,
          districtSlug: district.slug,
          city: cityName,
          citySlug,
          latitude,
          longitude,
          // Sourced from the curated list, never from position in the dataset.
          major: POPULAR_SLUG_SET.has(slug),
          sortOrder: sortOrder++,
        });
      }
    }
  }

  return locations;
}

/**
 * Flat list of every tradable place, in dataset order.
 *
 * `Object.freeze` is a development guard: the picker, the validator and the seed
 * all read this array, and a stray `.sort()` would silently reorder every list in
 * the app. `slice()` is therefore used wherever a mutable copy is needed.
 */
export const MARKETPLACE_LOCATIONS: readonly MarketplaceLocation[] =
  Object.freeze(buildLocations());

const LOCATIONS_BY_SLUG = new Map(
  MARKETPLACE_LOCATIONS.map((location) => [location.slug, location] as const),
);

/** Resolves a submitted slug. Returns undefined rather than throwing. */
export function findMarketplaceLocation(slug: string): MarketplaceLocation | undefined {
  return LOCATIONS_BY_SLUG.get(slug.trim().toLowerCase());
}

export function isSupportedMarketplaceLocation(slug: string): boolean {
  return findMarketplaceLocation(slug) !== undefined;
}

/** Distinct states, for the first step of the cascading picker. */
export function marketplaceStates(): { code: string; name: string }[] {
  return MARKETPLACE_STATES.map((state) => ({ code: state.code, name: state.name }));
}

/**
 * Districts of one state, alphabetical by official name.
 *
 * Alphabetical rather than dataset order because this is a browsable list of
 * 28 places, and a customer scanning it looks for a name rather than a position.
 */
export function marketplaceDistricts(stateCode: string): string[] {
  const state = findState(stateCode);
  if (!state) return [];

  return [...state.districts]
    .map((district) => district.name)
    .sort((left, right) => left.localeCompare(right, 'en'));
}

/** Headquarter town for a district, shown as context so two places are tellable apart. */
export function districtHeadquarters(stateCode: string, districtName: string): string | undefined {
  return findState(stateCode)?.districts.find((district) => district.name === districtName)
    ?.headquarters;
}

/**
 * Cities of one district, for the expanded district row.
 *
 * This is what makes the city list depend on the district: a professional in
 * Tirupati is never offered a Visakhapatnam city.
 */
export function marketplaceCities(stateCode: string, districtName: string): MarketplaceLocation[] {
  const state = findState(stateCode);
  if (!state) return [];

  const district = state.districts.find((entry) => entry.name === districtName);
  if (!district) return [];

  return district.cities.map(([name, latitude, longitude], index) => {
    const citySlug = slugifyLocationName(name);
    return {
      slug: `${state.code.toLowerCase()}-${district.slug}-${citySlug}`,
      stateCode: state.code,
      state: state.name,
      district: district.name,
      districtSlug: district.slug,
      city: name,
      citySlug,
      latitude,
      longitude,
      major: POPULAR_SLUG_SET.has(`${state.code.toLowerCase()}-${district.slug}-${citySlug}`),
      sortOrder: index,
    };
  });
}

/**
 * Curated well-known cities, for the quick-pick row above the district list.
 *
 * Ordered by `POPULAR_CITY_SLUGS`, not by dataset order, so the genuinely famous
 * cities lead rather than whatever happens to sort first alphabetically.
 */
export function majorMarketplaceLocations(): MarketplaceLocation[] {
  const ordered: MarketplaceLocation[] = [];

  for (const slug of POPULAR_CITY_SLUGS) {
    const location = LOCATIONS_BY_SLUG.get(slug);
    if (location) ordered.push(location);
  }

  return ordered;
}

/* ------------------------------------------------------- constituencies ---- */

export type ConstituencyReservation = 'NONE' | 'SC' | 'ST';

export interface AssemblyConstituency {
  /** Official constituency number, 1-175. Searchable by number as well as name. */
  number: number;
  /** Official constituency name. */
  name: string;
  reservation: ConstituencyReservation;
  /** District as published for the constituency. Context only - see the note below. */
  district: string;
}

/**
 * The 175 Andhra Pradesh Assembly constituencies.
 *
 * An assembly constituency is an electoral area, not a place: `Rayachoti` covers
 * dozens of villages, and `Gannavaram` is the name of two different
 * constituencies in two different districts. Treating one as a city would put a
 * marketplace location id on an area, so constituencies are deliberately kept out
 * of `MARKETPLACE_LOCATIONS` and cannot be chosen as a browsing location. They
 * are searchable context only, and selecting one reveals the places inside it
 * rather than pretending the constituency is a single city.
 *
 * District is recorded as published. Note that for a handful of seats the
 * published district grouping and the town geography differ - `Kandukur` is a
 * seat grouped under Nellore while the town itself is in Prakasam - so the town is
 * filed under its own district and the two views are not forced to agree.
 *
 * Ordering is by official number. Reservation follows the Election Commission of
 * India's 2008 delimitation order: 29 SC and 7 ST seats.
 */
const CONSTITUENCY_SEEDS: readonly (readonly [
  number: number,
  name: string,
  reservation: ConstituencyReservation,
  district: string,
])[] = [
  [1, 'Ichchapuram', 'NONE', 'Srikakulam'],
  [2, 'Palasa', 'NONE', 'Srikakulam'],
  [3, 'Tekkali', 'NONE', 'Srikakulam'],
  [4, 'Pathapatnam', 'NONE', 'Srikakulam'],
  [5, 'Srikakulam', 'NONE', 'Srikakulam'],
  [6, 'Amadalavalasa', 'NONE', 'Srikakulam'],
  [7, 'Etcherla', 'NONE', 'Vizianagaram'],
  [8, 'Narasannapeta', 'NONE', 'Srikakulam'],
  [9, 'Rajam', 'SC', 'Vizianagaram'],
  [10, 'Palakonda', 'ST', 'Parvathipuram Manyam'],
  [11, 'Kurupam', 'ST', 'Parvathipuram Manyam'],
  [12, 'Parvathipuram', 'SC', 'Parvathipuram Manyam'],
  [13, 'Salur', 'ST', 'Parvathipuram Manyam'],
  [14, 'Bobbili', 'NONE', 'Vizianagaram'],
  [15, 'Cheepurupalli', 'NONE', 'Vizianagaram'],
  [16, 'Gajapathinagaram', 'NONE', 'Vizianagaram'],
  [17, 'Nellimarla', 'NONE', 'Vizianagaram'],
  [18, 'Vizianagaram', 'NONE', 'Vizianagaram'],
  [19, 'Srungavarapukota', 'NONE', 'Visakhapatnam'],
  [20, 'Bhimili', 'NONE', 'Visakhapatnam'],
  [21, 'Visakhapatnam East', 'NONE', 'Visakhapatnam'],
  [22, 'Visakhapatnam South', 'NONE', 'Visakhapatnam'],
  [23, 'Visakhapatnam North', 'NONE', 'Visakhapatnam'],
  [24, 'Visakhapatnam West', 'NONE', 'Visakhapatnam'],
  [25, 'Gajuwaka', 'NONE', 'Visakhapatnam'],
  [26, 'Chodavaram', 'NONE', 'Anakapalli'],
  [27, 'Madugula', 'NONE', 'Anakapalli'],
  [28, 'Araku Valley', 'ST', 'Alluri Sitharama Raju'],
  [29, 'Paderu', 'ST', 'Alluri Sitharama Raju'],
  [30, 'Anakapalle', 'NONE', 'Anakapalli'],
  [31, 'Pendurthi', 'NONE', 'Anakapalli'],
  [32, 'Elamanchili', 'NONE', 'Anakapalli'],
  [33, 'Payakaraopet', 'SC', 'Anakapalli'],
  [34, 'Narsipatnam', 'NONE', 'Anakapalli'],
  [35, 'Tuni', 'NONE', 'Kakinada'],
  [36, 'Prathipadu', 'NONE', 'Kakinada'],
  [37, 'Pithapuram', 'NONE', 'Kakinada'],
  [38, 'Kakinada Rural', 'NONE', 'Kakinada'],
  [39, 'Peddapuram', 'NONE', 'Kakinada'],
  [40, 'Anaparthy', 'NONE', 'East Godavari'],
  [41, 'Kakinada City', 'NONE', 'Kakinada'],
  [42, 'Ramachandrapuram', 'NONE', 'Dr. B. R. Ambedkar Konaseema'],
  [43, 'Mummidivaram', 'NONE', 'Dr. B. R. Ambedkar Konaseema'],
  [44, 'Amalapuram', 'SC', 'Dr. B. R. Ambedkar Konaseema'],
  [45, 'Razole', 'NONE', 'Dr. B. R. Ambedkar Konaseema'],
  [46, 'Gannavaram', 'NONE', 'Dr. B. R. Ambedkar Konaseema'],
  [47, 'Kothapeta', 'NONE', 'Dr. B. R. Ambedkar Konaseema'],
  [48, 'Mandapeta', 'NONE', 'East Godavari'],
  [49, 'Rajanagaram', 'NONE', 'East Godavari'],
  [50, 'Rajahmundry City', 'NONE', 'East Godavari'],
  [51, 'Rajahmundry Rural', 'NONE', 'East Godavari'],
  [52, 'Jaggampeta', 'NONE', 'Kakinada'],
  [53, 'Rampachodavaram', 'ST', 'Polavaram'],
  [54, 'Kovvur', 'SC', 'East Godavari'],
  [55, 'Nidadavole', 'NONE', 'East Godavari'],
  [56, 'Achanta', 'NONE', 'West Godavari'],
  [57, 'Palakollu', 'NONE', 'West Godavari'],
  [58, 'Narasapuram', 'NONE', 'West Godavari'],
  [59, 'Bhimavaram', 'NONE', 'West Godavari'],
  [60, 'Undi', 'NONE', 'West Godavari'],
  [61, 'Tanuku', 'NONE', 'West Godavari'],
  [62, 'Tadepalligudem', 'NONE', 'West Godavari'],
  [63, 'Unguturu', 'NONE', 'Eluru'],
  [64, 'Denduluru', 'NONE', 'Eluru'],
  [65, 'Eluru', 'NONE', 'Eluru'],
  [66, 'Gopalapuram', 'SC', 'East Godavari'],
  [67, 'Polavaram', 'ST', 'Eluru'],
  [68, 'Chintalapudi', 'SC', 'Eluru'],
  [69, 'Tiruvuru', 'NONE', 'NTR'],
  [70, 'Nuzvid', 'NONE', 'Eluru'],
  [71, 'Gannavaram', 'NONE', 'Krishna'],
  [72, 'Gudivada', 'NONE', 'Krishna'],
  [73, 'Kaikalur', 'NONE', 'Eluru'],
  [74, 'Pedana', 'NONE', 'Krishna'],
  [75, 'Machilipatnam', 'NONE', 'Krishna'],
  [76, 'Avanigadda', 'NONE', 'Krishna'],
  [77, 'Pamarru', 'SC', 'Krishna'],
  [78, 'Penamaluru', 'NONE', 'Krishna'],
  [79, 'Vijayawada West', 'NONE', 'NTR'],
  [80, 'Vijayawada Central', 'NONE', 'NTR'],
  [81, 'Vijayawada East', 'NONE', 'NTR'],
  [82, 'Mylavaram', 'NONE', 'NTR'],
  [83, 'Nandigama', 'SC', 'NTR'],
  [84, 'Jaggayyapeta', 'NONE', 'NTR'],
  [85, 'Pedakurapadu', 'NONE', 'Palnadu'],
  [86, 'Tadikonda', 'SC', 'Guntur'],
  [87, 'Mangalagiri', 'NONE', 'Guntur'],
  [88, 'Ponnuru', 'NONE', 'Guntur'],
  [89, 'Vemuru', 'SC', 'Bapatla'],
  [90, 'Repalle', 'NONE', 'Bapatla'],
  [91, 'Tenali', 'NONE', 'Guntur'],
  [92, 'Bapatla', 'NONE', 'Bapatla'],
  [93, 'Prathipadu', 'SC', 'Guntur'],
  [94, 'Guntur West', 'NONE', 'Guntur'],
  [95, 'Guntur East', 'NONE', 'Guntur'],
  [96, 'Chilakaluripet', 'NONE', 'Palnadu'],
  [97, 'Narasaraopet', 'NONE', 'Palnadu'],
  [98, 'Sattenapalle', 'NONE', 'Palnadu'],
  [99, 'Vinukonda', 'NONE', 'Palnadu'],
  [100, 'Gurajala', 'NONE', 'Palnadu'],
  [101, 'Macherla', 'NONE', 'Palnadu'],
  [102, 'Yerragondapalem', 'SC', 'Markapuram'],
  [103, 'Darsi', 'NONE', 'Prakasam'],
  [104, 'Parchur', 'NONE', 'Bapatla'],
  [105, 'Addanki', 'NONE', 'Prakasam'],
  [106, 'Chirala', 'NONE', 'Bapatla'],
  [107, 'Santhanuthalapadu', 'SC', 'Prakasam'],
  [108, 'Ongole', 'NONE', 'Prakasam'],
  [109, 'Kandukur', 'NONE', 'Sri Potti Sriramulu Nellore'],
  [110, 'Kondapi', 'SC', 'Prakasam'],
  [111, 'Markapuram', 'NONE', 'Markapuram'],
  [112, 'Giddalur', 'NONE', 'Markapuram'],
  [113, 'Kanigiri', 'NONE', 'Markapuram'],
  [114, 'Kavali', 'NONE', 'Sri Potti Sriramulu Nellore'],
  [115, 'Atmakur', 'NONE', 'Sri Potti Sriramulu Nellore'],
  [116, 'Kovur', 'NONE', 'Sri Potti Sriramulu Nellore'],
  [117, 'Nellore City', 'NONE', 'Sri Potti Sriramulu Nellore'],
  [118, 'Nellore Rural', 'NONE', 'Sri Potti Sriramulu Nellore'],
  [119, 'Sarvepalli', 'NONE', 'Tirupati'],
  [120, 'Gudur', 'SC', 'Tirupati'],
  [121, 'Sullurpeta', 'NONE', 'Tirupati'],
  [122, 'Venkatagiri', 'NONE', 'Tirupati'],
  [123, 'Udayagiri', 'NONE', 'Sri Potti Sriramulu Nellore'],
  [124, 'Badvel', 'SC', 'YSR Kadapa'],
  [125, 'Rajampet', 'NONE', 'YSR Kadapa'],
  [126, 'Kadapa', 'NONE', 'YSR Kadapa'],
  [127, 'Kodur', 'SC', 'Tirupati'],
  [128, 'Rayachoti', 'NONE', 'Annamayya'],
  [129, 'Pulivendla', 'NONE', 'YSR Kadapa'],
  [130, 'Kamalapuram', 'NONE', 'YSR Kadapa'],
  [131, 'Jammalamadugu', 'NONE', 'YSR Kadapa'],
  [132, 'Proddatur', 'NONE', 'YSR Kadapa'],
  [133, 'Mydukur', 'NONE', 'YSR Kadapa'],
  [134, 'Allagadda', 'NONE', 'Nandyal'],
  [135, 'Srisailam', 'NONE', 'Nandyal'],
  [136, 'Nandikotkur', 'SC', 'Nandyal'],
  [137, 'Kurnool', 'NONE', 'Kurnool'],
  [138, 'Panyam', 'NONE', 'Nandyal'],
  [139, 'Nandyal', 'NONE', 'Nandyal'],
  [140, 'Banaganapalle', 'NONE', 'Nandyal'],
  [141, 'Dhone', 'NONE', 'Nandyal'],
  [142, 'Pattikonda', 'NONE', 'Kurnool'],
  [143, 'Kodumur', 'SC', 'Kurnool'],
  [144, 'Yemmiganur', 'NONE', 'Kurnool'],
  [145, 'Mantralayam', 'NONE', 'Kurnool'],
  [146, 'Adoni', 'NONE', 'Kurnool'],
  [147, 'Alur', 'NONE', 'Kurnool'],
  [148, 'Rayadurg', 'NONE', 'Ananthapuramu'],
  [149, 'Uravakonda', 'NONE', 'Ananthapuramu'],
  [150, 'Guntakal', 'NONE', 'Ananthapuramu'],
  [151, 'Tadipatri', 'NONE', 'Ananthapuramu'],
  [152, 'Singanamala', 'SC', 'Ananthapuramu'],
  [153, 'Anantapur Urban', 'NONE', 'Ananthapuramu'],
  [154, 'Kalyandurg', 'NONE', 'Ananthapuramu'],
  [155, 'Raptadu', 'NONE', 'Ananthapuramu'],
  [156, 'Madakasira', 'SC', 'Sri Sathya Sai'],
  [157, 'Hindupur', 'NONE', 'Sri Sathya Sai'],
  [158, 'Penukonda', 'NONE', 'Sri Sathya Sai'],
  [159, 'Puttaparthi', 'NONE', 'Sri Sathya Sai'],
  [160, 'Dharmavaram', 'NONE', 'Sri Sathya Sai'],
  [161, 'Kadiri', 'NONE', 'Sri Sathya Sai'],
  [162, 'Thamballapalle', 'NONE', 'Annamayya'],
  [163, 'Pileru', 'NONE', 'Annamayya'],
  [164, 'Madanapalle', 'NONE', 'Annamayya'],
  [165, 'Punganur', 'NONE', 'Annamayya'],
  [166, 'Chandragiri', 'NONE', 'Tirupati'],
  [167, 'Tirupati', 'NONE', 'Tirupati'],
  [168, 'Srikalahasti', 'NONE', 'Tirupati'],
  [169, 'Sathyavedu', 'SC', 'Tirupati'],
  [170, 'Nagari', 'NONE', 'Chittoor'],
  [171, 'Gangadhara Nellore', 'SC', 'Chittoor'],
  [172, 'Chittoor', 'NONE', 'Chittoor'],
  [173, 'Puthalapattu', 'SC', 'Chittoor'],
  [174, 'Palamaner', 'NONE', 'Chittoor'],
  [175, 'Kuppam', 'NONE', 'Chittoor'],
];

export const ASSEMBLY_CONSTITUENCIES: readonly AssemblyConstituency[] = Object.freeze(
  CONSTITUENCY_SEEDS.map(([number, name, reservation, district]) =>
    Object.freeze({ number, name, reservation, district }),
  ),
);

/* ------------------------------------------------------------- search ---- */

export type MarketplaceSearchResult =
  | { type: 'city'; location: MarketplaceLocation }
  | {
      type: 'district';
      stateCode: string;
      state: string;
      district: string;
      headquarters: string | undefined;
      cityCount: number;
    }
  | { type: 'constituency'; constituency: AssemblyConstituency };

function findState(stateCode: string): MarketplaceStateSeed | undefined {
  const wanted = stateCode.trim().toLowerCase();
  return MARKETPLACE_STATES.find((state) => state.code.toLowerCase() === wanted);
}

/**
 * One search across all three kinds of place a customer might type.
 *
 * Case-insensitive, and deliberately matching the *start* of a name as well as a
 * substring: `tir` should reach Tirupati, and so should `upat`, because nobody
 * remembers which district a town is in.
 *
 * A bare number is treated as a constituency number only when it is in range, so
 * typing "128" finds `128 - Rayachoti` without a plain "128" being matched against
 * every city.
 *
 * Results are typed, because the three are not interchangeable: only a `city`
 * result can be chosen as a browsing location.
 */
export function searchMarketplaceLocations(query: string, limit = 25): MarketplaceSearchResult[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];

  // Prefix matches first, substring matches after.
  //
  // The split matters for short queries: "ntr" is the NTR district and the city
  // Vijayawada, but it is also a run of letters inside "Mantralayam". Ranking by
  // a prefix a name actually begins with puts the place the customer meant above
  // the one that merely happens to contain the letters.
  const startsWith = (value: string): boolean => value.startsWith(trimmed);
  const contains = (value: string): boolean => value.includes(trimmed);

  const prefixCities: MarketplaceSearchResult[] = [];
  const substringCities: MarketplaceSearchResult[] = [];

  for (const location of MARKETPLACE_LOCATIONS) {
    const city = location.city.toLowerCase();
    const district = location.district.toLowerCase();

    if (startsWith(city) || startsWith(district)) {
      prefixCities.push({ type: 'city', location });
    } else if (contains(city) || contains(district)) {
      substringCities.push({ type: 'city', location });
    }
  }

  const districtResults: MarketplaceSearchResult[] = [];
  for (const state of MARKETPLACE_STATES) {
    for (const district of state.districts) {
      const name = district.name.toLowerCase();
      if (startsWith(name)) {
        districtResults.push({
          type: 'district',
          stateCode: state.code,
          state: state.name,
          district: district.name,
          headquarters: district.headquarters,
          cityCount: district.cities.length,
        });
      }
    }
  }

  // Deterministic order for the fuzzy tier, so the same query always looks the same.
  substringCities.sort((left, right) => {
    const a = left.type === 'city' ? left.location.city : '';
    const b = right.type === 'city' ? right.location.city : '';
    return a.localeCompare(b, 'en');
  });

  const constituencyResults: MarketplaceSearchResult[] = [];
  const asNumber = Number.parseInt(trimmed, 10);
  const numericQuery = Number.isFinite(asNumber) && String(asNumber) === trimmed ? asNumber : null;

  for (const constituency of ASSEMBLY_CONSTITUENCIES) {
    const name = constituency.name.toLowerCase();
    const matchesNumber =
      numericQuery !== null &&
      (constituency.number === numericQuery || String(constituency.number) === trimmed);
    if (startsWith(name) || contains(name) || matchesNumber) {
      constituencyResults.push({ type: 'constituency', constituency });
    }
  }

  return [...districtResults, ...prefixCities, ...constituencyResults, ...substringCities].slice(
    0,
    limit,
  );
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Nearest supported city to a GPS fix - the whole of the reverse-geocoding story.
 *
 * A city centroid is a good enough proxy for "which city is the device in" and it
 * needs no third-party service, no API key, no network round trip and no user
 * data leaving the device. Coordinates are used here and discarded; the caller
 * persists only the resulting slug.
 *
 * Deliberately not a radius search: nothing downstream ranks by distance, so a
 * great-circle comparison is all that is needed.
 */
export function nearestMarketplaceLocation(
  coordinates: Coordinates,
): MarketplaceLocation | undefined {
  const EARTH_RADIUS_KM = 6371;
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

  let best: MarketplaceLocation | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const location of MARKETPLACE_LOCATIONS) {
    const deltaLatitude = toRadians(location.latitude - coordinates.latitude);
    const deltaLongitude = toRadians(location.longitude - coordinates.longitude);
    const originLatitude = toRadians(coordinates.latitude);
    const targetLatitude = toRadians(location.latitude);

    const haversine =
      Math.sin(deltaLatitude / 2) ** 2 +
      Math.cos(originLatitude) * Math.cos(targetLatitude) * Math.sin(deltaLongitude / 2) ** 2;

    const distance = EARTH_RADIUS_KM * 2 * Math.asin(Math.min(1, Math.sqrt(haversine)));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = location;
    }
  }

  return best;
}
