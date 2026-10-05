import type { ProfessionalVerificationStatus } from './enums';
import type {
  MarketplaceLocation,
  ProfessionalReview,
  ProfessionalServiceOffering,
  WorkingHour,
} from './marketplace';

export interface CustomerService {
  id: string;
  title: string;
  summary: string | null;
}

export interface CustomerServiceCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  services: CustomerService[];
}

export interface CustomerDiscoveryService {
  id: string;
  title: string;
  summary: string | null;
  category: Pick<CustomerServiceCategory, 'id' | 'slug' | 'name'>;
}

export interface CustomerProfessional {
  id: string;
  fullName: string;
  businessName: string;
  bio: string | null;
  verification: ProfessionalVerificationStatus;
  serviceArea: string | null;
  /**
   * The place this professional trades in, or null when they have not set one.
   *
   * Always set on the location-filtered listing endpoints; a direct profile link
   * can still return null, because such a professional is in no city's
   * marketplace.
   */
  location: MarketplaceLocation | null;
  averageRating?: number;
  ratingCount?: number;
}

export interface CustomerServiceProfessionalsResponse {
  service: CustomerDiscoveryService;
  professionals: CustomerProfessional[];
}

export interface CustomerProfessionalProfile extends CustomerProfessional {
  avatarUrl: string | null;
  completedCount: number;
  reviews: ProfessionalReview[];
  services: CustomerDiscoveryService[];
  offerings: ProfessionalServiceOffering[];
  yearsOfExperience?: number;
  workingHours?: WorkingHour[];
}
