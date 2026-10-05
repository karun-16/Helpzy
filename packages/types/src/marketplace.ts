import type {
  AddressType,
  BookingStatus,
  NotificationType,
  PaymentMethod,
  PaymentStatus,
  ProfessionalVerificationStatus,
} from './enums';

/** One row of a professional's published availability. `day` is 0=Sun..6=Sat. */
export interface WorkingHour {
  day: number;
  start: string;
  end: string;
}

/**
 * A place HELPZY trades in, as it travels over the wire.
 *
 * `slug` is the identity the client stores and the API filters by; the names are
 * present only so the UI can print them. Coordinates are never sent: they exist to
 * resolve a GPS fix to a city, and once that is done they are discarded.
 */
export interface MarketplaceLocation {
  slug: string;
  state: string;
  district: string;
  city: string;
}

/**
 * What the customer currently wants to find services in.
 *
 * Kept deliberately separate from a customer profile address and from the
 * professional's own location: browsing another city must not require editing
 * where you live, and a customer's registered address must never silently decide
 * which marketplace they see.
 */
export interface MarketplaceLocationSelection {
  location: MarketplaceLocation;
  /** How the customer arrived at it, so the UI can explain itself. */
  source: 'detected' | 'manual';
}

/** A saved service address owned by one customer. */
export interface CustomerAddress {
  id: string;
  label: string;
  type: AddressType;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The account section of a customer's own profile. */
export interface CustomerProfile {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  avatarUrl: string | null;
  role: string;
  status: string;
  memberSince: string;
  bookingCount: number;
  addressCount: number;
}

/** A customer-editable profile. Phone is deliberately absent: it is the identity. */
export interface CustomerProfileUpdate {
  fullName?: string;
  email?: string | null;
  avatarUrl?: string | null;
}

/**
 * The customer-facing view of a professional.
 *
 * Every optional field is genuinely optional: the API omits anything the
 * professional has not filled in, so the app can render an honest empty state
 * instead of a fabricated value.
 */
export interface ProfessionalMarketplaceProfile {
  id: string;
  fullName: string;
  businessName: string;
  bio: string | null;
  verification: ProfessionalVerificationStatus;
  verificationNote?: string | null;
  serviceArea: string | null;
  location: MarketplaceLocation | null;
  avatarUrl: string | null;
  contactEmail?: string | null;
  phone?: string;
  yearsOfExperience?: number;
  workingHours?: WorkingHour[];
  completedCount: number;
  averageRating?: number;
  ratingCount?: number;
  reviews?: ProfessionalReview[];
  services: ProfessionalServiceOffering[];
}

/** A service the professional offers, with its real pricing. */
export interface ProfessionalServiceOffering {
  id: string;
  title: string;
  summary: string | null;
  description: string;
  priceAmount: number;
  currency: string;
  durationMinutes: number;
  category: { id: string; slug: string; name: string };
}

/** A published review, always tied to a real completed booking. */
export interface ProfessionalReview {
  id: string;
  rating: number;
  comment: string | null;
  customerName: string;
  serviceTitle: string;
  createdAt: string;
}

/** The professional's own, fully detailed profile for the edit screens. */
export interface ProfessionalOwnProfile {
  id: string;
  userId: string;
  fullName: string;
  phone: string;
  email: string | null;
  avatarUrl: string | null;
  businessName: string;
  bio: string | null;
  serviceArea: string | null;
  /**
   * The place this professional trades in, or null when they have not set one.
   *
   * Null is meaningful: it means the professional is not listed in any city's
   * marketplace, not that they are in an unknown one.
   */
  location: MarketplaceLocation | null;
  contactEmail: string | null;
  isPhoneVisible: boolean;
  yearsOfExperience: number | null;
  workingHours: WorkingHour[];
  verification: ProfessionalVerificationStatus;
  verifiedAt: string | null;
  rejectionNote: string | null;
  isLocationSharingEnabled: boolean;
  completedCount: number;
  averageRating: number;
  ratingCount: number;
}

export interface ProfessionalProfileUpdate {
  fullName?: string;
  avatarUrl?: string | null;
  businessName?: string;
  bio?: string | null;
  serviceArea?: string | null;
  /**
   * Set or clear the professional's marketplace location.
   *
   * A slug rather than free text, and validated against the shared dataset on the
   * server, so "Tirupati" cannot be stored as a different place from "tirupati".
   * `null` clears it and returns the professional to no city's marketplace.
   */
  locationSlug?: string | null;
  contactEmail?: string | null;
  isPhoneVisible?: boolean;
  yearsOfExperience?: number | null;
  workingHours?: WorkingHour[];
  isLocationSharingEnabled?: boolean;
}

/** A location fix reported by the professional's own device. */
export interface ProfessionalLocationUpdate {
  latitude: number;
  longitude: number;
}

/**
 * What a customer may see about an assigned professional's position.
 *
 * Populated only while sharing is on, the fix is fresh, and the booking is
 * actually under way.
 */
export interface AssignedProfessionalLocation {
  latitude: number;
  longitude: number;
  updatedAt: string;
  isStale: boolean;
  distanceKm: number | null;
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  bookingId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationSummary {
  items: Notification[];
  unreadCount: number;
}

export interface BookingMessage {
  id: string;
  bookingId: string;
  senderUserId: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  senderName: string;
}

/** The payment record attached to a booking. */
export interface BookingPayment {
  id: string;
  bookingId: string;
  amount: number;
  currency: string;
  method: PaymentMethod | null;
  status: PaymentStatus;
  provider: string | null;
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
}

/**
 * Whether an online gateway is configured. When false the app must not offer
 * an online path at all rather than pretending one exists.
 */
export interface PaymentCapability {
  onlineAvailable: boolean;
  directAvailable: true;
  providerName: string | null;
}

/** A service owned by a professional, for the management screens. */
export interface ProfessionalServiceRecord {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  description: string;
  priceAmount: number;
  currency: string;
  durationMinutes: number;
  isActive: boolean;
  category: { id: string; slug: string; name: string };
  bookingCount: number;
}

export interface AdminUserSummary {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: string;
  status: string;
  createdAt: string;
}

export interface AdminVerificationRequest {
  profileId: string;
  userId: string;
  fullName: string;
  phone: string;
  email: string | null;
  businessName: string;
  bio: string | null;
  serviceArea: string | null;
  verification: ProfessionalVerificationStatus;
  verifiedAt: string | null;
  rejectionNote: string | null;
  serviceCount: number;
  submittedAt: string;
}

export interface AdminAuditEntry {
  id: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
}

export interface AdminDashboardSummary {
  users: { total: number; customers: number; professionals: number; admins: number };
  bookings: { total: number; byStatus: Partial<Record<BookingStatus, number>> };
  payments: { total: number; paid: number; pending: number; failed: number };
  reviews: { total: number; pending: number; published: number };
  pendingVerifications: number;
  unreadNotifications: number;
}
