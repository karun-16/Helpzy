import { Injectable, NotFoundException } from '@nestjs/common';
import {
  API_ERROR_CODES,
  ROLES,
  type CustomerProfessional,
  type CustomerProfessionalProfile,
  type CustomerServiceCategory,
} from '@helpzy/types';

import { PrismaService } from '../database/prisma.service';

const AVAILABLE_PROFESSIONAL_FILTER = {
  role: ROLES.PROFESSIONAL,
  status: 'ACTIVE' as const,
  professionalProfile: { isNot: null },
};

@Injectable()
export class CustomerDiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  async getCategories(): Promise<CustomerServiceCategory[]> {
    const categories = await this.prisma.serviceCategory.findMany({
      where: {
        isActive: true,
        services: {
          some: {
            isActive: true,
            owner: { is: AVAILABLE_PROFESSIONAL_FILTER },
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        iconUrl: true,
        services: {
          where: {
            isActive: true,
            owner: { is: AVAILABLE_PROFESSIONAL_FILTER },
          },
          orderBy: { title: 'asc' },
          select: { id: true, title: true, summary: true },
        },
      },
    });

    return categories;
  }

  async getProfessionalsForService(serviceId: string) {
    const service = await this.prisma.service.findFirst({
      where: {
        id: serviceId,
        isActive: true,
        category: { isActive: true },
        owner: { is: AVAILABLE_PROFESSIONAL_FILTER },
      },
      select: {
        id: true,
        title: true,
        summary: true,
        category: { select: { id: true, slug: true, name: true } },
        owner: {
          select: {
            id: true,
            fullName: true,
            professionalProfile: {
              select: {
                businessName: true,
                bio: true,
                verification: true,
                serviceArea: true,
                averageRating: true,
                ratingCount: true,
              },
            },
          },
        },
      },
    });

    if (!service?.owner.professionalProfile) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'The selected service is no longer available.',
      });
    }

    const { owner, ...serviceDetails } = service;
    return {
      service: serviceDetails,
      professionals: [this.toProfessional(owner)],
    };
  }

  async getProfessionalProfile(professionalId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: professionalId,
        ...AVAILABLE_PROFESSIONAL_FILTER,
      },
      select: {
        id: true,
        fullName: true,
        professionalProfile: {
          select: {
            businessName: true,
            bio: true,
            verification: true,
            serviceArea: true,
            averageRating: true,
            ratingCount: true,
          },
        },
        services: {
          where: {
            isActive: true,
            category: { isActive: true },
          },
          orderBy: { title: 'asc' },
          select: {
            id: true,
            title: true,
            summary: true,
            category: { select: { id: true, slug: true, name: true } },
          },
        },
      },
    });

    if (!user?.professionalProfile) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'The selected professional profile was not found.',
      });
    }

    return {
      ...this.toProfessional({
        id: user.id,
        fullName: user.fullName,
        professionalProfile: user.professionalProfile,
      }),
      services: user.services,
    };
  }

  async getAvailableProfessionals(): Promise<CustomerProfessionalProfile[]> {
    const users = await this.prisma.user.findMany({
      where: {
        ...AVAILABLE_PROFESSIONAL_FILTER,
        services: {
          some: {
            isActive: true,
            category: { isActive: true },
          },
        },
      },
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        fullName: true,
        professionalProfile: {
          select: {
            businessName: true,
            bio: true,
            verification: true,
            serviceArea: true,
            averageRating: true,
            ratingCount: true,
          },
        },
        services: {
          where: {
            isActive: true,
            category: { isActive: true },
          },
          orderBy: { title: 'asc' },
          select: {
            id: true,
            title: true,
            summary: true,
            category: { select: { id: true, slug: true, name: true } },
          },
        },
      },
    });

    return users.flatMap((user) =>
      user.professionalProfile
        ? [
            {
              ...this.toProfessional(user),
              services: user.services,
            },
          ]
        : [],
    );
  }

  private toProfessional<
    T extends {
      id: string;
      fullName: string;
      professionalProfile: {
        businessName: string;
        bio: string | null;
        verification: CustomerProfessional['verification'];
        serviceArea: string | null;
        averageRating: { toNumber: () => number };
        ratingCount: number;
      } | null;
    },
  >(user: T): CustomerProfessional {
    const profile = user.professionalProfile;
    if (!profile) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'The selected professional profile was not found.',
      });
    }

    return {
      id: user.id,
      fullName: user.fullName,
      businessName: profile.businessName,
      bio: profile.bio,
      verification: profile.verification,
      serviceArea: profile.serviceArea,
      ...(profile.ratingCount > 0
        ? { averageRating: profile.averageRating.toNumber(), ratingCount: profile.ratingCount }
        : {}),
    };
  }
}
