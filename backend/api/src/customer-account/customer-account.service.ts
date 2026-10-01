import { Injectable, NotFoundException } from '@nestjs/common';
import { API_ERROR_CODES, ROLES, type AddressType } from '@helpzy/types';
import type {
  CustomerAddressDto,
  CustomerProfileDto,
  UpdateCustomerProfileDto,
  UpsertCustomerAddressDto,
} from '@helpzy/validation';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { ProfilePhotoService, type AllowedProfileImageType } from '../media/profile-photo.service';

const addressSelect = {
  id: true,
  label: true,
  type: true,
  line1: true,
  line2: true,
  city: true,
  state: true,
  postalCode: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AddressSelect;

type AddressRecord = Prisma.AddressGetPayload<{ select: typeof addressSelect }>;

/**
 * The customer's own account and address book.
 *
 * Every query is scoped by the session user id resolved from the JWT. Nothing
 * here accepts a customer id from the client, so no route can reach another
 * customer's rows.
 */
@Injectable()
export class CustomerAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profilePhotos: ProfilePhotoService,
  ) {}

  async getProfile(userId: string): Promise<CustomerProfileDto> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: ROLES.CUSTOMER },
      select: {
        id: true,
        fullName: true,
        phone: true,
        email: true,
        avatarUrl: true,
        role: true,
        status: true,
        createdAt: true,
        _count: { select: { bookingsAsCustomer: true, addresses: true } },
      },
    });
    if (!user) throw profileNotFound();

    return {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone ?? '',
      email: user.email,
      avatarUrl: user.avatarUrl,
      role: user.role,
      status: user.status,
      memberSince: user.createdAt.toISOString(),
      bookingCount: user._count.bookingsAsCustomer,
      addressCount: user._count.addresses,
    };
  }

  async updateProfile(
    userId: string,
    input: UpdateCustomerProfileDto,
  ): Promise<CustomerProfileDto> {
    // `phone` is intentionally absent from the update: it is the login identity
    // and changing it must not be possible through a profile form.
    const result = await this.prisma.user.updateMany({
      where: { id: userId, role: ROLES.CUSTOMER },
      data: {
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      },
    });
    if (result.count !== 1) throw profileNotFound();
    return this.getProfile(userId);
  }

  async uploadAvatar(
    userId: string,
    input: { data: string; contentType: AllowedProfileImageType },
  ) {
    return this.profilePhotos.upload(userId, ROLES.CUSTOMER, input);
  }

  async listAddresses(userId: string): Promise<CustomerAddressDto[]> {
    const rows = await this.prisma.address.findMany({
      where: { userId },
      select: addressSelect,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toAddressDto);
  }

  async createAddress(
    userId: string,
    input: UpsertCustomerAddressDto,
  ): Promise<CustomerAddressDto> {
    const existingCount = await this.prisma.address.count({ where: { userId } });

    const row = await this.prisma.$transaction(async (transaction) => {
      // The first address, or an explicit request, clears the previous default
      // so at most one row can ever hold the flag.
      const wantsDefault = input.isDefault === true || existingCount === 0;
      if (wantsDefault) await this.clearDefault(transaction, userId);

      return transaction.address.create({
        data: {
          userId,
          label: input.label,
          type: input.type,
          line1: input.line1,
          line2: input.line2 || null,
          city: input.city,
          state: input.state,
          postalCode: input.postalCode,
          isDefault: wantsDefault,
        },
        select: addressSelect,
      });
    });

    return toAddressDto(row);
  }

  async updateAddress(
    userId: string,
    addressId: string,
    input: UpsertCustomerAddressDto,
  ): Promise<CustomerAddressDto> {
    await this.assertOwned(userId, addressId);

    const row = await this.prisma.$transaction(async (transaction) => {
      if (input.isDefault) await this.clearDefault(transaction, userId);
      return transaction.address.update({
        where: { id: addressId },
        data: {
          label: input.label,
          type: input.type,
          line1: input.line1,
          line2: input.line2 || null,
          city: input.city,
          state: input.state,
          postalCode: input.postalCode,
          ...(input.isDefault ? { isDefault: true } : {}),
        },
        select: addressSelect,
      });
    });

    return toAddressDto(row);
  }

  async setDefaultAddress(userId: string, addressId: string): Promise<CustomerAddressDto> {
    await this.assertOwned(userId, addressId);

    const row = await this.prisma.$transaction(async (transaction) => {
      await this.clearDefault(transaction, userId);
      return transaction.address.update({
        where: { id: addressId },
        data: { isDefault: true },
        select: addressSelect,
      });
    });

    return toAddressDto(row);
  }

  async deleteAddress(userId: string, addressId: string): Promise<{ deleted: boolean }> {
    const result = await this.prisma.address.deleteMany({
      where: { id: addressId, userId },
    });
    if (result.count === 0) throw addressNotFound();
    return { deleted: true };
  }

  /**
   * Ownership check performed before a write. Scoping the write itself is the
   * real guarantee; this turns a cross-account attempt into a clear 404 rather
   * than a confusing no-op.
   */
  private async assertOwned(userId: string, addressId: string): Promise<void> {
    const owned = await this.prisma.address.count({ where: { id: addressId, userId } });
    if (owned === 0) throw addressNotFound();
  }

  private async clearDefault(transaction: Prisma.TransactionClient, userId: string): Promise<void> {
    await transaction.address.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
  }
}

function toAddressDto(row: AddressRecord): CustomerAddressDto {
  return {
    id: row.id,
    label: row.label,
    type: row.type,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function profileNotFound() {
  return new NotFoundException({
    code: API_ERROR_CODES.NOT_FOUND,
    message: 'Your account could not be found.',
  });
}

export function addressNotFound() {
  return new NotFoundException({
    code: API_ERROR_CODES.NOT_FOUND,
    message: 'That address could not be found.',
  });
}

export type { AddressType };
