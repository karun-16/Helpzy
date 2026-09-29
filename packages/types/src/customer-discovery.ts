import type { ProfessionalVerificationStatus } from './enums';

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
  averageRating?: number;
  ratingCount?: number;
}

export interface CustomerServiceProfessionalsResponse {
  service: CustomerDiscoveryService;
  professionals: CustomerProfessional[];
}

export interface CustomerProfessionalProfile {
  id: string;
  fullName: string;
  businessName: string;
  bio: string | null;
  verification: ProfessionalVerificationStatus;
  serviceArea: string | null;
  averageRating?: number;
  ratingCount?: number;
  services: CustomerDiscoveryService[];
}
