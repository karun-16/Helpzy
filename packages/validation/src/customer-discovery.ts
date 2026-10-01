import { z } from 'zod';
import { PROFESSIONAL_VERIFICATION_STATUSES } from '@helpzy/types';

import {
  professionalReviewSchema,
  professionalServiceOfferingSchema,
  workingHoursSchema,
} from './marketplace';

const customerServiceSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  summary: z.string().nullable(),
});

const discoveryServiceSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  summary: z.string().nullable(),
  category: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
  }),
});

const professionalSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  businessName: z.string(),
  bio: z.string().nullable(),
  verification: z.enum(PROFESSIONAL_VERIFICATION_STATUSES),
  serviceArea: z.string().nullable(),
  averageRating: z.number().nonnegative().optional(),
  ratingCount: z.number().int().nonnegative().optional(),
});

export const customerServiceCategoriesSchema = z.array(
  z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    iconUrl: z.string().nullable(),
    services: z.array(customerServiceSchema),
  }),
);

export const customerServiceProfessionalsSchema = z.object({
  service: discoveryServiceSchema,
  professionals: z.array(professionalSchema),
});

export const customerProfessionalProfileSchema = professionalSchema.extend({
  avatarUrl: z.string().nullable(),
  completedCount: z.number().int().nonnegative(),
  reviews: z.array(professionalReviewSchema).default([]),
  services: z.array(discoveryServiceSchema),
  offerings: z.array(professionalServiceOfferingSchema).default([]),
  yearsOfExperience: z.number().int().nonnegative().optional(),
  workingHours: workingHoursSchema.optional(),
});

export const customerAvailableProfessionalsSchema = z.array(customerProfessionalProfileSchema);

export type CustomerServiceCategoriesDto = z.infer<typeof customerServiceCategoriesSchema>;
export type CustomerServiceProfessionalsDto = z.infer<typeof customerServiceProfessionalsSchema>;
export type CustomerProfessionalProfileDto = z.infer<typeof customerProfessionalProfileSchema>;
export type CustomerAvailableProfessionalsDto = z.infer<
  typeof customerAvailableProfessionalsSchema
>;
